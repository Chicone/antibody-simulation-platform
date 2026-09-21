#!/usr/bin/env python3
"""
Grid-search Martini Go parameters against an AA RMSF reference.

Run from:
    /Users/luiscamara/PyCharm/abmd/antibody_dashboard

Example:
    python calibrate_martini_go.py \
      --protein-pdb /path/to/protein.pdb \
      --aa-rmsf /path/to/rmsf_ca_fixed.xvg \
      --duration-ns 4.63 \
      --nt 4 \
      --parallel 2

The script:
  - creates one isolated Martini job per Go parameter combination
  - reuses backend.pipelines.martini_pipeline.run_martini_pipeline()
  - computes Martini BB RMSF over the requested production window
  - compares it residue-by-residue with the AA C-alpha RMSF
  - ranks candidates by RMSF RMSE + correlation
  - checkpoints results.csv after every completed candidate

Default grid:
    go_epsilon = 9.414
    go_lower = 0.3
    go_upper = 1.1
=> 1 baseline run
"""

from __future__ import annotations

import argparse
import csv
import itertools
import json
import math
import shutil
import subprocess
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import numpy as np


DEFAULT_EPSILONS = [9.414]
DEFAULT_LOWERS = [0.3]
DEFAULT_UPPERS = [1.1]


@dataclass(frozen=True)
class GridPoint:
    epsilon: float
    lower: float
    upper: float
    replica: int = 1

    @property
    def label(self) -> str:
        return f"ge{self.epsilon:g}_gl{self.lower:g}_gu{self.upper:g}_rep{self.replica}"


def parse_xvg(path: Path) -> tuple[np.ndarray, np.ndarray]:
    x, y = [], []
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith(("#", "@", "&")):
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            try:
                x.append(float(parts[0]))
                y.append(float(parts[1]))
            except ValueError:
                pass

    if not y:
        raise RuntimeError(f"No numeric data found in {path}")

    return np.asarray(x, float), np.asarray(y, float)


def rankdata(values: np.ndarray) -> np.ndarray:
    """Average ranks for ties, without requiring scipy."""
    values = np.asarray(values)
    order = np.argsort(values, kind="mergesort")
    ranks = np.empty(len(values), dtype=float)

    i = 0
    while i < len(values):
        j = i
        while j + 1 < len(values) and values[order[j + 1]] == values[order[i]]:
            j += 1
        avg_rank = (i + j) / 2.0 + 1.0
        ranks[order[i:j + 1]] = avg_rank
        i = j + 1

    return ranks


def corr(a: np.ndarray, b: np.ndarray) -> float:
    if len(a) < 2 or np.std(a) == 0 or np.std(b) == 0:
        return float("nan")
    return float(np.corrcoef(a, b)[0, 1])


def build_mask(
    n_residues: int,
    chain_lengths: list[int],
    exclude_termini: int,
) -> np.ndarray:
    if sum(chain_lengths) != n_residues:
        raise RuntimeError(
            f"AA RMSF has {n_residues} residues but chain lengths sum to "
            f"{sum(chain_lengths)} ({chain_lengths})."
        )

    mask = np.ones(n_residues, dtype=bool)
    offset = 0

    for length in chain_lengths:
        start = offset
        end = offset + length
        n = min(max(exclude_termini, 0), length // 2)

        if n:
            mask[start:start + n] = False
            mask[end - n:end] = False

        offset = end

    return mask


def compute_metrics(
    aa: np.ndarray,
    martini: np.ndarray,
    mask: np.ndarray,
) -> dict[str, float]:
    if not np.all(np.isfinite(aa)) or not np.all(np.isfinite(martini)):
        raise RuntimeError("RMSF contains non-finite values")
    if len(aa) != len(martini):
        raise RuntimeError(
            f"Residue count mismatch: AA={len(aa)}, Martini={len(martini)}"
        )

    a = aa[mask]
    m = martini[mask]
    delta = m - a

    rmse = float(np.sqrt(np.mean(delta ** 2)))
    mae = float(np.mean(np.abs(delta)))
    bias = float(np.mean(delta))
    pearson = corr(a, m)
    spearman = corr(rankdata(a), rankdata(m))

    # Lower is better. RMSE is primary; correlation is a secondary penalty.
    corr_penalty = 1.0 if math.isnan(pearson) else 1.0 - pearson
    score = rmse + 0.05 * corr_penalty

    return {
        "score": score,
        "rmse_nm": rmse,
        "mae_nm": mae,
        "bias_nm": bias,
        "pearson": pearson,
        "spearman": spearman,
        "aa_mean_rmsf_nm": float(np.mean(a)),
        "martini_mean_rmsf_nm": float(np.mean(m)),
        "n_scored_residues": int(mask.sum()),
    }


def write_bb_index_from_gro(gro_path: Path, ndx_path: Path) -> int:
    """
    Create a minimal GROMACS index containing Martini backbone beads named BB.
    This avoids relying on gmx make_ndx group numbering.
    """
    lines = gro_path.read_text(encoding="utf-8", errors="replace").splitlines()

    if len(lines) < 3:
        raise RuntimeError(f"Invalid GRO file: {gro_path}")

    try:
        n_atoms = int(lines[1].strip())
    except ValueError as exc:
        raise RuntimeError(f"Invalid atom count in {gro_path}") from exc

    atom_lines = lines[2:2 + n_atoms]
    indices: list[int] = []

    for line in atom_lines:
        if len(line) < 20:
            continue

        atom_name = line[10:15].strip()
        atom_number_text = line[15:20].strip()

        if atom_name == "BB":
            try:
                indices.append(int(atom_number_text))
            except ValueError:
                pass

    if not indices:
        raise RuntimeError(f"No Martini BB beads found in {gro_path}")

    with ndx_path.open("w", encoding="utf-8") as fh:
        fh.write("[ BackboneBB ]\n")
        for i in range(0, len(indices), 15):
            fh.write(" ".join(str(x) for x in indices[i:i + 15]) + "\n")

    return len(indices)


def run_gmx_rmsf(
    out_dir: Path,
    duration_ns: float,
    log_path: Path,
) -> Path:
    gro = out_dir / "production.gro"
    tpr = out_dir / "production.tpr"
    xtc = out_dir / "production.xtc"

    for path in (gro, tpr, xtc):
        if not path.exists():
            raise FileNotFoundError(path)

    ndx = out_dir / "backbone_bb.ndx"
    n_bb = write_bb_index_from_gro(gro, ndx)
    if n_bb != 434:
        raise RuntimeError(f"Expected 434 physical BB beads, found {n_bb}")

    rmsf = out_dir / "rmsf_bb.xvg"
    end_ps = duration_ns * 1000.0

    cmd = [
        "gmx", "rmsf",
        "-s", str(tpr),
        "-f", str(xtc),
        "-n", str(ndx),
        "-o", str(rmsf),
        "-res",
        "-b", "0",
        "-e", f"{end_ps:g}",
    ]

    with log_path.open("a", encoding="utf-8") as log:
        log.write("\n=== CALIBRATION RMSF ===\n")
        log.write(f"BackboneBB beads: {n_bb}\n")
        log.write("$ " + " ".join(cmd) + "\n")
        log.flush()

        proc = subprocess.run(
            cmd,
            cwd=str(out_dir),
            input="BackboneBB\n",
            text=True,
            stdout=log,
            stderr=subprocess.STDOUT,
        )

    if proc.returncode != 0:
        raise RuntimeError(f"gmx rmsf failed with exit code {proc.returncode}")

    return rmsf


def prepare_job(
    root: Path,
    protein_pdb: Path,
    point: GridPoint,
    duration_ns: float,
    nt: int,
    salt: float,
    temperature: float,
) -> Path:
    job_dir = root / point.label
    input_dir = job_dir / "input"

    input_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(protein_pdb, input_dir / "protein.pdb")

    params = {
        "duration_ns": duration_ns,
        "method": "martini",
        "model": "go",
        "go_epsilon": point.epsilon,
        "go_lower": point.lower,
        "go_upper": point.upper,
        "salt_concentration": salt,
        "temperature": temperature,
        "nt": nt,
    }

    (input_dir / "params.json").write_text(
        json.dumps(params, indent=2) + "\n",
        encoding="utf-8",
    )

    return job_dir


def run_candidate(
    point: GridPoint,
    *,
    root: Path,
    protein_pdb: Path,
    aa_rmsf_values: np.ndarray,
    mask: np.ndarray,
    duration_ns: float,
    nt: int,
    salt: float,
    temperature: float,
) -> dict:
    start = time.time()
    job_dir = root / point.label

    result = {
        "label": point.label,
        "go_epsilon": point.epsilon,
        "go_lower": point.lower,
        "go_upper": point.upper,
        "replica": point.replica,
        "reused": "false",
        "status": "failed",
        "job_dir": str(job_dir),
    }

    try:
        job_dir = prepare_job(
            root=root,
            protein_pdb=protein_pdb,
            point=point,
            duration_ns=duration_ns,
            nt=nt,
            salt=salt,
            temperature=temperature,
        )

        out_dir = job_dir / "out"
        log_path = job_dir / "log.txt"

        # Reuse the exact Martini implementation that is already working
        # in the dashboard.
        from backend.pipelines.martini_pipeline import run_martini_pipeline

        # Resume-friendly: if production.gro already exists, don't rerun MD.
        if not (out_dir / "production.gro").exists():
            run_martini_pipeline(job_dir)

        rmsf_path = out_dir / "rmsf_bb.xvg"
        if not rmsf_path.exists():
            rmsf_path = run_gmx_rmsf(
                out_dir=out_dir,
                duration_ns=duration_ns,
                log_path=log_path,
            )

        _, martini_values = parse_xvg(rmsf_path)
        if not np.all(np.isfinite(martini_values)):
            raise RuntimeError("Martini BB RMSF contains non-finite values")
        metrics = compute_metrics(
            aa=aa_rmsf_values,
            martini=martini_values,
            mask=mask,
        )

        result.update(metrics)
        result["status"] = "done"

    except Exception as exc:
        result["error"] = str(exc)
        tb = traceback.format_exc()
        result["traceback"] = tb

        try:
            job_dir.mkdir(parents=True, exist_ok=True)
            (job_dir / "calibration_error.txt").write_text(
                tb,
                encoding="utf-8",
            )
        except Exception:
            pass

    result["wall_minutes"] = (time.time() - start) / 60.0
    return result


def write_results(csv_path: Path, rows: list[dict]) -> None:
    fields = [
        "rank",
        "status",
        "label",
        "go_epsilon",
        "go_lower",
        "go_upper",
        "replica",
        "reused",
        "score",
        "rmse_nm",
        "mae_nm",
        "bias_nm",
        "pearson",
        "spearman",
        "aa_mean_rmsf_nm",
        "martini_mean_rmsf_nm",
        "n_scored_residues",
        "wall_minutes",
        "job_dir",
        "error",
    ]

    good = sorted(
        [r for r in rows if r.get("status") == "done"],
        key=lambda r: r["score"],
    )
    bad = [r for r in rows if r.get("status") != "done"]

    output_rows = []

    for rank, row in enumerate(good, 1):
        row = dict(row)
        row["rank"] = rank
        output_rows.append(row)

    for row in bad:
        row = dict(row)
        row["rank"] = ""
        output_rows.append(row)

    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(output_rows)


def parse_float_list(text: str) -> list[float]:
    return [float(x.strip()) for x in text.split(",") if x.strip()]


def parse_int_list(text: str) -> list[int]:
    return [int(x.strip()) for x in text.split(",") if x.strip()]


def load_reused_results(path: Path | None) -> list[dict]:
    """Load compatible completed replicas prepared by the dashboard backend."""
    if path is None or not path.exists():
        return []

    numeric_fields = (
        "go_epsilon", "go_lower", "go_upper",
        "score", "rmse_nm", "mae_nm", "bias_nm",
        "pearson", "spearman", "aa_mean_rmsf_nm",
        "martini_mean_rmsf_nm", "wall_minutes",
    )
    int_fields = ("replica", "n_scored_residues")

    reused = []
    with path.open("r", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row.get("status") != "done":
                continue
            item = dict(row)
            try:
                for field in numeric_fields:
                    if item.get(field) not in (None, ""):
                        item[field] = float(item[field])
                for field in int_fields:
                    if item.get(field) not in (None, ""):
                        item[field] = int(float(item[field]))
            except (TypeError, ValueError):
                continue
            item["reused"] = "true"
            reused.append(item)

    return reused


def main() -> int:
    parser = argparse.ArgumentParser()

    parser.add_argument("--protein-pdb", type=Path, required=True)
    parser.add_argument("--aa-rmsf", type=Path, required=True)

    parser.add_argument("--duration-ns", type=float, default=4.63)
    parser.add_argument("--nt", type=int, default=4)
    parser.add_argument("--parallel", type=int, default=2)
    parser.add_argument("--replicas", type=int, default=1)

    parser.add_argument(
        "--epsilons",
        default="9.414",
        help="Comma-separated Go contact well depths.",
    )
    parser.add_argument(
        "--lowers",
        default="0.3",
        help="Comma-separated Go lower cutoffs (nm).",
    )
    parser.add_argument(
        "--uppers",
        default="1.1",
        help="Comma-separated Go upper cutoffs (nm).",
    )

    parser.add_argument("--salt", type=float, default=0.15)
    parser.add_argument("--temperature", type=float, default=310.0)

    parser.add_argument(
        "--chain-lengths",
        default="214,220",
        help="Comma-separated chain lengths. Current Fab: 214,220.",
    )
    parser.add_argument(
        "--exclude-termini",
        type=int,
        default=3,
        help="Residues excluded from each chain terminus during scoring.",
    )

    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("data") / "martini_calibration",
    )
    parser.add_argument(
        "--reuse-results",
        type=Path,
        default=None,
        help="CSV of compatible completed replicas to reuse.",
    )

    args = parser.parse_args()

    if args.nt < 1:
        parser.error("--nt must be >= 1")
    if args.parallel < 1:
        parser.error("--parallel must be >= 1")
    if args.replicas < 1:
        parser.error("--replicas must be >= 1")
    if any(x <= 0 for x in parse_float_list(args.epsilons)):
        parser.error("Go epsilon values must be > 0")
    if args.duration_ns <= 0:
        parser.error("--duration-ns must be > 0")

    protein_pdb = args.protein_pdb.expanduser().resolve()
    aa_rmsf = args.aa_rmsf.expanduser().resolve()
    output_root = args.output_root.expanduser().resolve()
    reuse_results_path = (
        args.reuse_results.expanduser().resolve()
        if args.reuse_results is not None
        else None
    )

    if not protein_pdb.exists():
        parser.error(f"Protein PDB not found: {protein_pdb}")
    if not aa_rmsf.exists():
        parser.error(f"AA RMSF not found: {aa_rmsf}")

    # Must be launched from antibody_dashboard root so backend imports work.
    repo_root = Path.cwd()
    if not (repo_root / "backend").exists():
        print(
            "ERROR: run this script from the antibody_dashboard root, e.g.\n"
            "cd /Users/luiscamara/PyCharm/abmd/antibody_dashboard",
            file=sys.stderr,
        )
        return 2

    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

    try:
        from backend.pipelines.martini_pipeline import run_martini_pipeline  # noqa
    except Exception as exc:
        print(
            f"ERROR: cannot import Martini pipeline: {exc}",
            file=sys.stderr,
        )
        return 2

    _, aa_values = parse_xvg(aa_rmsf)
    if len(aa_values) != 434 or not np.all(np.isfinite(aa_values)):
        parser.error("AA reference must contain 434 finite residue RMSF values")

    chain_lengths = parse_int_list(args.chain_lengths)
    mask = build_mask(
        n_residues=len(aa_values),
        chain_lengths=chain_lengths,
        exclude_termini=args.exclude_termini,
    )

    epsilons = parse_float_list(args.epsilons)
    lowers = parse_float_list(args.lowers)
    uppers = parse_float_list(args.uppers)

    grid = [
        GridPoint(f, lo, hi, replica)
        for f, lo, hi in itertools.product(epsilons, lowers, uppers)
        if lo < hi
        for replica in range(1, args.replicas + 1)
    ]

    stamp = time.strftime("%Y%m%d_%H%M%S")
    root = output_root / f"grid_{stamp}"
    root.mkdir(parents=True, exist_ok=True)

    config = {
        "protein_pdb": str(protein_pdb),
        "aa_rmsf": str(aa_rmsf),
        "duration_ns": args.duration_ns,
        "threads_per_job": args.nt,
        "parallel_jobs": args.parallel,
        "replicas": args.replicas,
        "nominal_total_threads": args.nt * args.parallel,
        "epsilons": epsilons,
        "lowers": lowers,
        "uppers": uppers,
        "salt_concentration": args.salt,
        "temperature": args.temperature,
        "chain_lengths": chain_lengths,
        "exclude_termini": args.exclude_termini,
        "n_candidates": len(grid),
    }

    reused_results = load_reused_results(reuse_results_path)
    requested_labels = {point.label for point in grid}
    reused_results = [
        row for row in reused_results
        if row.get("label") in requested_labels
    ]
    reused_labels = {row["label"] for row in reused_results}
    pending_grid = [point for point in grid if point.label not in reused_labels]

    config["n_reused"] = len(reused_results)
    config["n_new_simulations"] = len(pending_grid)

    (root / "calibration_config.json").write_text(
        json.dumps(config, indent=2) + "\n",
        encoding="utf-8",
    )

    print()
    print("Martini Go calibration")
    print("======================")
    print(f"Candidates       : {len(grid)}")
    print(f"Reused results   : {len(reused_results)}")
    print(f"New simulations  : {len(pending_grid)}")
    print(f"Production/run   : {args.duration_ns:g} ns")
    print(f"Parallel jobs    : {args.parallel}")
    print(f"Replicas/point   : {args.replicas}")
    print(f"Threads/job      : {args.nt}")
    print(f"Nominal threads  : {args.parallel * args.nt}")
    print(f"AA residues      : {len(aa_values)}")
    print(f"Scored residues  : {int(mask.sum())}")
    print(f"Output directory : {root}")
    print()

    results = list(reused_results)
    results_csv = root / "results.csv"
    write_results(results_csv, results)

    for row in reused_results:
        print(f"[REUSE] {row['label']:23s} from {row.get('job_dir', 'previous calibration')}")

    with ThreadPoolExecutor(max_workers=args.parallel) as pool:
        futures = {
            pool.submit(
                run_candidate,
                point,
                root=root,
                protein_pdb=protein_pdb,
                aa_rmsf_values=aa_values,
                mask=mask,
                duration_ns=args.duration_ns,
                nt=args.nt,
                salt=args.salt,
                temperature=args.temperature,
            ): point
            for point in pending_grid
        }

        for future in as_completed(futures):
            point = futures[future]
            result = future.result()
            results.append(result)

            if result["status"] == "done":
                print(
                    f"[DONE] {point.label:23s} "
                    f"RMSE={result['rmse_nm']:.4f} nm  "
                    f"Pearson={result['pearson']:.3f}  "
                    f"Spearman={result['spearman']:.3f}  "
                    f"{result['wall_minutes']:.1f} min"
                )
            else:
                print(
                    f"[FAIL] {point.label:23s} "
                    f"{result.get('error', 'unknown error')}"
                )

            # Checkpoint after every job so an interrupted overnight search
            # still leaves all completed results.
            write_results(results_csv, results)

    write_results(results_csv, results)

    good = sorted(
        [r for r in results if r.get("status") == "done"],
        key=lambda r: r["score"],
    )

    print()
    print(f"Results written to: {results_csv}")

    if not good:
        print("No candidate completed successfully.")
        return 1

    print()
    print("Top candidates")
    print("--------------")
    for rank, row in enumerate(good[:10], 1):
        print(
            f"{rank:2d}. {row['label']:23s} "
            f"score={row['score']:.4f}  "
            f"RMSE={row['rmse_nm']:.4f} nm  "
            f"r={row['pearson']:.3f}  "
            f"rho={row['spearman']:.3f}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
