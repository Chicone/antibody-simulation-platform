from __future__ import annotations

import json
import subprocess
import sys
import uuid
from pathlib import Path
import csv
import os
import shutil
from datetime import datetime
from zoneinfo import ZoneInfo

DASHBOARD_ROOT = Path(__file__).resolve().parents[2]
ABMD_ROOT = DASHBOARD_ROOT.parent

CALIBRATION_SCRIPT = (
    ABMD_ROOT
    / "scripts"
    / "calibrate_martini_en.py"
)

GO_CALIBRATION_SCRIPT = ABMD_ROOT / "scripts" / "calibrate_martini_go.py"


def _model(metadata: dict) -> str:
    return metadata.get("model", "elastic")


def _keys(model: str) -> tuple[str, str, str]:
    return (("go_epsilon", "go_lower", "go_upper") if model == "go"
            else ("elastic_force", "elastic_lower", "elastic_upper"))


CALIBRATION_ROOT = (
    DASHBOARD_ROOT
    / "data"
    / "calibration_jobs"
)


def _parse_float_values(text: str) -> list[float]:
    return [float(value.strip()) for value in text.split(",") if value.strip()]


def _collect_reusable_results(
    *,
    aa_job_id: str,
    duration_ns: float,
    forces: str,
    lowers: str,
    uppers: str,
    replicas: int,
    model: str = "elastic",
) -> list[dict]:
    """Collect compatible completed trajectories from older calibrations.

    Compatibility is intentionally conservative: same AA reference job and the
    same production duration. EN parameters must match the newly requested grid.
    The newest compatible trajectories are preferred and are renumbered locally
    as replicas 1..N for the new calibration.
    """
    if not CALIBRATION_ROOT.exists():
        return []

    requested_points = {
        (force, lower, upper)
        for force in _parse_float_values(forces)
        for lower in _parse_float_values(lowers)
        for upper in _parse_float_values(uppers)
        if lower < upper
    }
    if not requested_points:
        return []

    keys = _keys(model)
    candidates = []
    for calibration_dir in CALIBRATION_ROOT.iterdir():
        if not calibration_dir.is_dir():
            continue
        metadata_file = calibration_dir / "calibration.json"
        if not metadata_file.exists():
            continue
        try:
            metadata = json.loads(metadata_file.read_text(encoding="utf-8"))
            if _model(metadata) != model or metadata.get("aa_job_id") != aa_job_id:
                continue
            if abs(float(metadata.get("duration_ns")) - float(duration_ns)) > 1e-9:
                continue
            results_csv = _find_results_csv(calibration_dir)
            if results_csv is None:
                continue
            mtime = results_csv.stat().st_mtime
            with results_csv.open("r", encoding="utf-8") as handle:
                for row in csv.DictReader(handle):
                    if row.get("status") != "done":
                        continue
                    try:
                        point = (
                            float(row[keys[0]]),
                            float(row[keys[1]]),
                            float(row[keys[2]]),
                        )
                    except (KeyError, TypeError, ValueError):
                        continue
                    if point not in requested_points:
                        continue
                    candidates.append((mtime, calibration_dir.name, point, dict(row)))
        except Exception:
            continue

    # Newest completed trajectories first. A physical trajectory is identified
    # by its job_dir, so the same row cannot be counted twice if it was already
    # reused by an intermediate calibration.
    candidates.sort(key=lambda item: item[0], reverse=True)
    selected_by_point: dict[tuple[float, float, float], list[dict]] = {}
    seen_job_dirs: set[str] = set()

    for _, source_calibration, point, row in candidates:
        group = selected_by_point.setdefault(point, [])
        if len(group) >= replicas:
            continue
        job_dir = row.get("job_dir", "")
        if job_dir and job_dir in seen_job_dirs:
            continue
        if job_dir:
            seen_job_dirs.add(job_dir)
        row["source_calibration_id"] = source_calibration
        group.append(row)

    reusable = []
    for (force, lower, upper), group in selected_by_point.items():
        for replica, row in enumerate(group, start=1):
            row = dict(row)
            row[keys[0]] = force
            row[keys[1]] = lower
            row[keys[2]] = upper
            row["replica"] = replica
            row["label"] = (
                (f"ge{force:g}_gl{lower:g}_gu{upper:g}_rep{replica}" if model == "go"
                 else f"ef{force:g}_el{lower:g}_eu{upper:g}_rep{replica}")
            )
            row["reused"] = "true"
            reusable.append(row)

    return reusable


def _write_reuse_csv(path: Path, rows: list[dict], model: str = "elastic") -> None:
    if not rows:
        return
    fields = [
        "status", "label", *_keys(model), "replica", "reused", "score",
        "rmse_nm", "mae_nm", "bias_nm", "pearson",
        "spearman", "aa_mean_rmsf_nm", "martini_mean_rmsf_nm",
        "n_scored_residues", "wall_minutes", "job_dir", "error",
        "source_calibration_id",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def start_calibration(
    aa_job_id: str,
    duration_ns: float,
    nt: int,
    parallel: int,
    replicas: int,
    forces: str,
    lowers: str,
    uppers: str,
    model: str = "elastic",
) -> dict:

    if model not in {"elastic", "go"}:
        raise ValueError("model must be elastic or go")
    script = GO_CALIBRATION_SCRIPT if model == "go" else CALIBRATION_SCRIPT
    if not script.is_file():
        raise FileNotFoundError(f"Calibration runner not found: {script}")

    aa_job_dir = (
        DASHBOARD_ROOT
        / "data"
        / "runs"
        / aa_job_id
    )

    protein_pdb = (
        aa_job_dir
        / "input"
        / "protein.pdb"
    )

    aa_rmsf = (
            aa_job_dir
            / "out"
            / "rmsf_ca_10ns.xvg"
    )

    if not protein_pdb.exists():
        raise FileNotFoundError(
            f"AA protein PDB not found: {protein_pdb}"
        )

    if not aa_rmsf.exists():
        raise FileNotFoundError(
            f"AA RMSF not found: {aa_rmsf}"
        )

    calibration_id = str(uuid.uuid4())

    calibration_dir = (
        CALIBRATION_ROOT
        / calibration_id
    )

    calibration_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    log_file = (
        calibration_dir
        / "calibration.log"
    )

    reusable_results = _collect_reusable_results(
        aa_job_id=aa_job_id,
        duration_ns=duration_ns,
        forces=forces,
        lowers=lowers,
        uppers=uppers,
        replicas=replicas,
        model=model,
    )
    reuse_csv = calibration_dir / "reuse_results.csv"
    _write_reuse_csv(reuse_csv, reusable_results, model)

    command = [
        sys.executable,
        str(script),

        "--protein-pdb",
        str(protein_pdb),

        "--aa-rmsf",
        str(aa_rmsf),

        "--duration-ns",
        str(duration_ns),

        "--nt",
        str(nt),

        "--parallel",
        str(parallel),

        "--replicas",
        str(replicas),

        "--epsilons" if model == "go" else "--forces",
        forces,

        "--lowers",
        lowers,

        "--uppers",
        uppers,

        "--output-root",
        str(calibration_dir / "runs"),
    ]

    if reusable_results:
        command.extend([
            "--reuse-results",
            str(reuse_csv),
        ])

    with open(
        log_file,
        "a",
        encoding="utf-8",
    ) as log:

        process = subprocess.Popen(
            command,
            cwd=str(DASHBOARD_ROOT),
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True,
            start_new_session=True,
        )

    metadata = {
        "calibration_id": calibration_id,
        "model": model,
        "created_at": datetime.now(
            ZoneInfo("Europe/Paris")
        ).isoformat(timespec="seconds"),
        "aa_job_id": aa_job_id,
        "pid": process.pid,
        "duration_ns": duration_ns,
        "nt": nt,
        "parallel": parallel,
        "replicas": replicas,
        "reused_results": len(reusable_results),
        "forces": forces,
        "lowers": lowers,
        "uppers": uppers,
        "status": "running",
    }

    (
        calibration_dir
        / "calibration.json"
    ).write_text(
        json.dumps(
            metadata,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    return metadata

def _find_results_csv(
    calibration_dir: Path,
) -> Path | None:
    """Find the results.csv produced by the calibration script."""

    runs_dir = calibration_dir / "runs"

    if not runs_dir.exists():
        return None

    matches = list(
        runs_dir.glob("grid_*/results.csv")
    )

    if not matches:
        return None

    return max(
        matches,
        key=lambda path: path.stat().st_mtime,
    )


def _process_is_running(pid: int) -> bool:
    """Return True if the calibration parent process still exists."""

    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _aggregate_successful_rows(rows: list[dict], model: str = "elastic") -> list[dict]:
    """Aggregate completed replicas by EN parameter set."""
    import statistics

    keys = _keys(model)
    groups: dict[tuple[float, float, float], list[dict]] = {}
    for row in rows:
        if row.get("status") != "done":
            continue
        try:
            key = (
                float(row[keys[0]]),
                float(row[keys[1]]),
                float(row[keys[2]]),
            )
            groups.setdefault(key, []).append(row)
        except (KeyError, TypeError, ValueError):
            continue

    aggregated = []
    metrics = ("score", "rmse_nm", "pearson", "spearman")
    for (force, lower, upper), group in groups.items():
        item = {
            keys[0]: force,
            keys[1]: lower,
            keys[2]: upper,
            "replicas": len(group),
        }
        for metric in metrics:
            values = [float(row[metric]) for row in group]
            item[metric] = statistics.mean(values)
            item[f"{metric}_sd"] = statistics.stdev(values) if len(values) > 1 else 0.0
        aggregated.append(item)

    aggregated.sort(key=lambda row: row["score"])
    return aggregated


def get_calibration_status(
    calibration_id: str,
) -> dict:

    calibration_dir = (
        CALIBRATION_ROOT
        / calibration_id
    )

    metadata_file = (
        calibration_dir
        / "calibration.json"
    )

    if not metadata_file.exists():
        raise FileNotFoundError(
            f"Calibration not found: {calibration_id}"
        )

    metadata = json.loads(
        metadata_file.read_text(
            encoding="utf-8"
        )
    )

    model = metadata.get("model", "elastic")

    forces = [
        value
        for value in metadata["forces"].split(",")
        if value.strip()
    ]

    lowers = [
        value
        for value in metadata["lowers"].split(",")
        if value.strip()
    ]

    uppers = [
        value
        for value in metadata["uppers"].split(",")
        if value.strip()
    ]

    replicas = max(1, int(metadata.get("replicas", 1)))

    total = (
        len(forces)
        * len(lowers)
        * len(uppers)
        * replicas
    )

    results_csv = _find_results_csv(
        calibration_dir
    )

    rows = []

    if results_csv is not None:
        with results_csv.open(
            "r",
            encoding="utf-8",
        ) as handle:
            rows = list(
                csv.DictReader(handle)
            )

    # One row appears after every candidate finishes,
    # including failed candidates.
    completed = len(rows)

    successful = [
        row
        for row in rows
        if row.get("status") == "done"
    ]

    aggregated = _aggregate_successful_rows(rows, _model(metadata))
    top_results = []
    for row in aggregated[:10]:
        top_results.append(
            {
                "rank": len(top_results) + 1,
                **row,
            }
        )

    pid = int(metadata["pid"])

    running = _process_is_running(pid)

    # results.csv is authoritative for completion. A finished subprocess can
    # briefly remain visible to the OS (e.g. as a zombie), so checking the PID
    # first can leave a completed calibration stuck at "running".
    if completed >= total and total > 0:
        status = "done"
    elif running:
        status = "running"
    else:
        status = "failed"

    progress = (
        100.0 * completed / total
        if total
        else 0.0
    )

    reused = sum(
        1 for row in rows
        if str(row.get("reused", "")).lower() in {"1", "true", "yes"}
    )

    return {
        "calibration_id": calibration_id,
        "model": model,
        "status": status,
        "replicas_requested": replicas,
        "reused": reused,
        "completed": completed,
        "total": total,
        "progress_percent": progress,
        "successful": len(successful),
        "failed": completed - len(successful),
        "top_results": top_results,
    }



def list_calibrations(
    limit: int = 20,
) -> list[dict]:
    """List persisted calibration jobs, newest first."""

    calibrations = []

    if not CALIBRATION_ROOT.exists():
        return calibrations

    for calibration_dir in CALIBRATION_ROOT.iterdir():
        if not calibration_dir.is_dir():
            continue

        metadata_file = calibration_dir / "calibration.json"

        if not metadata_file.exists():
            continue

        try:
            metadata = json.loads(
                metadata_file.read_text(encoding="utf-8")
            )

            # Older calibrations predate created_at. Preserve them in history
            # using the metadata file modification time as a fallback.
            created_at = metadata.get("created_at")
            if not created_at:
                created_at = datetime.fromtimestamp(
                    metadata_file.stat().st_mtime,
                    tz=ZoneInfo("Europe/Paris"),
                ).isoformat(timespec="seconds")

            status_data = get_calibration_status(
                calibration_dir.name
            )

            calibrations.append(
                {
                    **metadata,
                    "calibration_id": calibration_dir.name,
                    "created_at": created_at,
                    "status": status_data.get(
                        "status",
                        metadata.get("status", "unknown"),
                    ),
                    "completed": status_data.get("completed", 0),
                    "total": status_data.get("total", 0),
                    "successful": status_data.get("successful", 0),
                    "failed": status_data.get("failed", 0),
                }
            )
        except Exception:
            # A damaged history entry should not make the complete history
            # endpoint unavailable.
            continue

    calibrations.sort(
        key=lambda item: item.get("created_at", ""),
        reverse=True,
    )

    if limit > 0:
        calibrations = calibrations[:limit]

    return calibrations


def delete_calibration(
    calibration_id: str,
) -> bool:
    """Delete a persisted calibration after it is no longer running."""

    calibration_dir = CALIBRATION_ROOT / calibration_id
    metadata_file = calibration_dir / "calibration.json"

    if not calibration_dir.exists():
        return False

    if metadata_file.exists():
        try:
            metadata = json.loads(
                metadata_file.read_text(encoding="utf-8")
            )
            pid = int(metadata.get("pid", 0))
            if pid > 0 and _process_is_running(pid):
                raise RuntimeError(
                    "Cannot delete a running calibration"
                )
        except RuntimeError:
            raise
        except Exception:
            pass

    shutil.rmtree(calibration_dir)
    return True


def get_calibration_results(
    calibration_id: str,
) -> list[dict]:
    """Return all successfully completed candidates from results.csv."""

    calibration_dir = CALIBRATION_ROOT / calibration_id

    if not calibration_dir.exists():
        raise FileNotFoundError(
            f"Calibration not found: {calibration_id}"
        )

    results_csv = _find_results_csv(calibration_dir)

    # A newly started calibration may not have produced results.csv yet.
    if results_csv is None:
        return []

    rows = []

    with results_csv.open(
        "r",
        encoding="utf-8",
    ) as handle:
        rows = list(csv.DictReader(handle))

    metadata = json.loads((calibration_dir / "calibration.json").read_text(encoding="utf-8"))
    return _aggregate_successful_rows(rows, _model(metadata))


def _collect_compatible_aggregates(
    calibration_id: str,
) -> tuple[dict, list[dict]]:
    """Pool completed, compatible trajectories across calibration history.

    Compatibility matches the reuse policy: same AA reference and same
    production duration. Physical trajectories are deduplicated by job_dir so a
    reused trajectory is counted only once. The returned rows are aggregated by
    (ef, el, eu) and include replica SDs for GP observation noise.
    """
    import statistics

    calibration_dir = CALIBRATION_ROOT / calibration_id
    metadata_file = calibration_dir / "calibration.json"
    if not metadata_file.exists():
        raise FileNotFoundError(f"Calibration not found: {calibration_id}")

    target = json.loads(metadata_file.read_text(encoding="utf-8"))
    target_model = _model(target)
    keys = _keys(target_model)
    target_aa = target.get("aa_job_id")
    target_duration = float(target.get("duration_ns"))

    physical_rows: list[dict] = []
    seen: set[str] = set()

    if CALIBRATION_ROOT.exists():
        calibration_dirs = sorted(
            [path for path in CALIBRATION_ROOT.iterdir() if path.is_dir()],
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
    else:
        calibration_dirs = []

    for source_dir in calibration_dirs:
        source_meta_file = source_dir / "calibration.json"
        if not source_meta_file.exists():
            continue
        try:
            source_meta = json.loads(source_meta_file.read_text(encoding="utf-8"))
            if _model(source_meta) != target_model or source_meta.get("aa_job_id") != target_aa:
                continue
            if abs(float(source_meta.get("duration_ns")) - target_duration) > 1e-9:
                continue
            results_csv = _find_results_csv(source_dir)
            if results_csv is None:
                continue
            with results_csv.open("r", encoding="utf-8") as handle:
                for row_index, row in enumerate(csv.DictReader(handle)):
                    if row.get("status") != "done":
                        continue
                    key = row.get("job_dir") or (
                        f"{source_dir.name}:{row.get('label', row_index)}"
                    )
                    if key in seen:
                        continue
                    seen.add(key)
                    physical_rows.append(dict(row))
        except Exception:
            continue

    groups: dict[tuple[float, float, float], list[dict]] = {}
    for row in physical_rows:
        try:
            key = (
                float(row[keys[0]]),
                float(row[keys[1]]),
                float(row[keys[2]]),
            )
            # Validate the metrics used by the GP before accepting the row.
            for metric in ("score", "rmse_nm", "pearson", "spearman"):
                float(row[metric])
            groups.setdefault(key, []).append(row)
        except (KeyError, TypeError, ValueError):
            continue

    aggregated: list[dict] = []
    metrics = ("score", "rmse_nm", "pearson", "spearman")
    for (force, lower, upper), rows in groups.items():
        item = {
            keys[0]: force,
            keys[1]: lower,
            keys[2]: upper,
            "replicas": len(rows),
        }
        for metric in metrics:
            values = [float(row[metric]) for row in rows]
            item[metric] = statistics.mean(values)
            item[f"{metric}_sd"] = (
                statistics.stdev(values) if len(values) > 1 else 0.0
            )
        aggregated.append(item)

    aggregated.sort(
        key=lambda row: (
            row[keys[0]],
            row[keys[1]],
            row[keys[2]],
        )
    )
    return target, aggregated


def get_calibration_gp_surface(
    calibration_id: str,
    *,
    x_param: str = "elastic_force",
    y_param: str = "elastic_lower",
    fixed_param: str = "elastic_upper",
    fixed_value: float = 0.9,
    metric: str = "score",
    resolution: int = 30,
) -> dict:
    """Fit a heteroscedastic Gaussian Process and evaluate one 2-D plane.

    The GP is trained on all compatible historical calibration points, pooling
    unique trajectories and using the replica standard error as observation
    noise. Inputs and the target are scaled before fitting.
    """
    try:
        import numpy as np
        from sklearn.gaussian_process import GaussianProcessRegressor
        from sklearn.gaussian_process.kernels import ConstantKernel, Matern
        from scipy.optimize import differential_evolution
    except ImportError as error:
        raise RuntimeError(
            "Gaussian-process analysis requires scikit-learn. "
            "Install it with: pip install scikit-learn"
        ) from error

    metadata, rows = _collect_compatible_aggregates(calibration_id)
    model = _model(metadata)
    param_order = list(_keys(model))
    valid_params = set(param_order)
    if model == "go" and (x_param, y_param, fixed_param) == ("elastic_force", "elastic_lower", "elastic_upper"):
        x_param, y_param, fixed_param = param_order
        if fixed_value == 0.9:
            fixed_value = 1.1
    if {x_param, y_param, fixed_param} != valid_params:
        raise ValueError(
            f"x_param, y_param and fixed_param must be the three distinct {model} parameters"
        )
    if metric not in {"score", "rmse_nm", "pearson", "spearman"}:
        raise ValueError("Unsupported GP metric")

    resolution = max(12, min(int(resolution), 60))
    if len(rows) < 4:
        raise ValueError(
            "At least four distinct compatible parameter combinations are required for GP analysis"
        )

    unique_counts = {
        param: len({float(row[param]) for row in rows})
        for param in param_order
    }
    missing_variation = [param for param, count in unique_counts.items() if count < 2]
    if missing_variation:
        raise ValueError(
            f"GP hypersurface needs at least two sampled values for each {model} parameter. "
            + "Missing variation in: "
            + ", ".join(missing_variation)
        )

    X = np.asarray(
        [[float(row[param]) for param in param_order] for row in rows],
        dtype=float,
    )
    y = np.asarray([float(row[metric]) for row in rows], dtype=float)

    x_min = X.min(axis=0)
    x_max = X.max(axis=0)
    x_span = x_max - x_min
    x_span[x_span == 0.0] = 1.0
    X_scaled = (X - x_min) / x_span

    y_mean = float(y.mean())
    y_scale = float(y.std(ddof=0))
    if not np.isfinite(y_scale) or y_scale < 1e-12:
        y_scale = 1.0
    y_scaled = (y - y_mean) / y_scale

    # The target at each parameter combination is a replica mean. Therefore the
    # relevant noise is the variance of that mean: SD^2 / n. For a single
    # replica (or zero SD), fall back to the median measured variance.
    measured_variances = []
    for row in rows:
        n = max(1, int(row.get("replicas", 1)))
        sd = float(row.get(f"{metric}_sd", 0.0) or 0.0)
        if n > 1 and sd > 0:
            measured_variances.append((sd * sd) / n)
    fallback_variance = (
        float(np.median(measured_variances))
        if measured_variances
        else max((0.05 * y_scale) ** 2, 1e-8)
    )
    alpha = []
    for row in rows:
        n = max(1, int(row.get("replicas", 1)))
        sd = float(row.get(f"{metric}_sd", 0.0) or 0.0)
        variance = (sd * sd) / n if n > 1 and sd > 0 else fallback_variance
        alpha.append(max(variance / (y_scale * y_scale), 1e-8))
    alpha = np.asarray(alpha, dtype=float)

    kernel = ConstantKernel(1.0, (1e-3, 1e3)) * Matern(
        length_scale=[0.35, 0.35, 0.35],
        length_scale_bounds=(0.03, 10.0),
        nu=2.5,
    )
    gp = GaussianProcessRegressor(
        kernel=kernel,
        alpha=alpha,
        normalize_y=False,
        n_restarts_optimizer=5,
        random_state=0,
    )
    gp.fit(X_scaled, y_scaled)

    # Search the full 3-D GP response surface inside the sampled parameter
    # bounds. Optimizing in normalized coordinates keeps the three EN
    # parameters numerically comparable. Correlation metrics are maximized;
    # error/score metrics are minimized.
    maximize = metric in {"pearson", "spearman"}

    def _gp_objective(point_scaled):
        prediction = float(gp.predict(np.asarray(point_scaled, dtype=float).reshape(1, -1))[0])
        return -prediction if maximize else prediction

    # A single stochastic optimizer run can occasionally miss a slightly better
    # basin. Use several deterministic seeds and retain the best 3-D solution.
    optimization_candidates = []
    for seed in range(8):
        candidate = differential_evolution(
            _gp_objective,
            bounds=[(0.0, 1.0)] * 3,
            seed=seed,
            polish=True,
            tol=1e-8,
            updating="immediate",
            workers=1,
        )
        optimization_candidates.append(candidate)

    optimum = min(optimization_candidates, key=lambda result: float(result.fun))
    global_scaled = np.clip(np.asarray(optimum.x, dtype=float), 0.0, 1.0)
    global_point = x_min + global_scaled * x_span
    global_mean_scaled, global_std_scaled = gp.predict(
        global_scaled.reshape(1, -1),
        return_std=True,
    )
    global_mean = float(global_mean_scaled[0] * y_scale + y_mean)
    global_std = float(global_std_scaled[0] * y_scale)

    index = {name: i for i, name in enumerate(param_order)}
    x_index = index[x_param]
    y_index = index[y_param]
    fixed_index = index[fixed_param]

    x_values = np.linspace(x_min[x_index], x_max[x_index], resolution)
    y_values = np.linspace(x_min[y_index], x_max[y_index], resolution)

    prediction_points = []
    for y_value in y_values:
        for x_value in x_values:
            point = np.zeros(3, dtype=float)
            # Fill with center values, then overwrite all three coordinates.
            point[:] = (x_min + x_max) / 2.0
            point[x_index] = x_value
            point[y_index] = y_value
            point[fixed_index] = float(fixed_value)
            prediction_points.append(point)
    prediction_points = np.asarray(prediction_points, dtype=float)
    prediction_scaled = (prediction_points - x_min) / x_span

    mean_scaled, std_scaled = gp.predict(prediction_scaled, return_std=True)
    means = mean_scaled * y_scale + y_mean
    stds = std_scaled * y_scale

    surface = []
    for point, mean, std in zip(prediction_points, means, stds):
        surface.append(
            {
                "x": float(point[x_index]),
                "y": float(point[y_index]),
                "mean": float(mean),
                "std": float(std),
            }
        )

    best_index = int(np.argmax(means) if maximize else np.argmin(means))
    best_grid_point = prediction_points[best_index]

    # Refine the heatmap's best grid cell with a continuous 2-D optimization on
    # the selected plane. The displayed plane optimum is therefore not limited
    # by heatmap resolution.
    fixed_scaled = (float(fixed_value) - x_min[fixed_index]) / x_span[fixed_index]

    def _plane_objective(xy_scaled):
        point_scaled = np.empty(3, dtype=float)
        point_scaled[x_index] = float(xy_scaled[0])
        point_scaled[y_index] = float(xy_scaled[1])
        point_scaled[fixed_index] = fixed_scaled
        return _gp_objective(point_scaled)

    plane_candidates = []
    for seed in range(8):
        candidate = differential_evolution(
            _plane_objective,
            bounds=[(0.0, 1.0), (0.0, 1.0)],
            seed=seed,
            polish=True,
            tol=1e-8,
            updating="immediate",
            workers=1,
        )
        plane_candidates.append(
            (float(candidate.fun), np.asarray(candidate.x, dtype=float))
        )

    # Also test deterministic candidates. This prevents a narrow basin already
    # known from the grid or the 3-D optimum from being missed by the 2-D search.
    grid_xy_scaled = np.asarray([
        (best_grid_point[x_index] - x_min[x_index]) / x_span[x_index],
        (best_grid_point[y_index] - x_min[y_index]) / x_span[y_index],
    ], dtype=float)
    plane_candidates.append(
        (float(_plane_objective(grid_xy_scaled)), grid_xy_scaled)
    )

    # Project the full 3-D optimum onto the requested plane. In particular,
    # "Show optimum plane" must recover the 3-D optimum when fixed_value equals
    # the optimum's fixed coordinate.
    projected_global_xy_scaled = np.asarray(
        [global_scaled[x_index], global_scaled[y_index]], dtype=float
    )
    plane_candidates.append((
        float(_plane_objective(projected_global_xy_scaled)),
        projected_global_xy_scaled,
    ))

    _, plane_xy_scaled = min(plane_candidates, key=lambda item: item[0])

    best_point = np.empty(3, dtype=float)
    best_point[x_index] = x_min[x_index] + float(plane_xy_scaled[0]) * x_span[x_index]
    best_point[y_index] = x_min[y_index] + float(plane_xy_scaled[1]) * x_span[y_index]
    best_point[fixed_index] = float(fixed_value)
    best_point_scaled = (best_point - x_min) / x_span
    best_mean_scaled, best_std_scaled = gp.predict(
        best_point_scaled.reshape(1, -1),
        return_std=True,
    )
    best_mean = float(best_mean_scaled[0] * y_scale + y_mean)
    best_std = float(best_std_scaled[0] * y_scale)

    # Sanity guard: a restricted-plane optimum cannot be better than the full
    # 3-D optimum. If the plane search uncovers a better numerical candidate,
    # promote that point so the API never reports contradictory optima.
    plane_is_better = best_mean > global_mean if maximize else best_mean < global_mean
    if plane_is_better:
        global_point = best_point.copy()
        global_scaled = best_point_scaled.copy()
        global_mean = best_mean
        global_std = best_std

    # Overlay only observations on the selected plane. Floating-point tolerance
    # scales with the sampled range of the fixed parameter.
    fixed_tolerance = max(abs(x_span[fixed_index]) * 1e-6, 1e-9)
    observed = []
    for row in rows:
        if abs(float(row[fixed_param]) - float(fixed_value)) <= fixed_tolerance:
            observed.append(
                {
                    "x": float(row[x_param]),
                    "y": float(row[y_param]),
                    "value": float(row[metric]),
                    "sd": float(row.get(f"{metric}_sd", 0.0) or 0.0),
                    "replicas": int(row.get("replicas", 1)),
                }
            )

    # sklearn exposes the optimized product kernel as k1 * k2. Convert learned
    # normalized length scales back to the original EN parameter units.
    learned_length_scales = np.asarray(gp.kernel_.k2.length_scale, dtype=float)
    length_scales_original = learned_length_scales * x_span

    parameter_values = {
        param: sorted({float(row[param]) for row in rows})
        for param in param_order
    }

    return {
        "calibration_id": calibration_id,
        "model": model,
        "aa_job_id": metadata.get("aa_job_id"),
        "duration_ns": metadata.get("duration_ns"),
        "model": model,
        "metric": metric,
        "training_points": len(rows),
        "training_trajectories": sum(int(row.get("replicas", 1)) for row in rows),
        "x_param": x_param,
        "y_param": y_param,
        "fixed_param": fixed_param,
        "fixed_value": float(fixed_value),
        "parameter_values": parameter_values,
        "length_scales": {
            param: float(length_scales_original[i])
            for i, param in enumerate(param_order)
        },
        "surface": surface,
        "observed": observed,
        "global_best": {
            param_order[0]: float(global_point[0]),
            param_order[1]: float(global_point[1]),
            param_order[2]: float(global_point[2]),
            "mean": global_mean,
            "std": global_std,
            "objective": "maximum" if maximize else "minimum",
            "bounded_by_observed_range": True,
        },
        "parameter_bounds": {
            param: {
                "min": float(x_min[i]),
                "max": float(x_max[i]),
            }
            for i, param in enumerate(param_order)
        },
        "predicted_best": {
            x_param: float(best_point[x_index]),
            y_param: float(best_point[y_index]),
            fixed_param: float(fixed_value),
            "mean": best_mean,
            "std": best_std,
        },
    }

def read_calibration_log(
    calibration_id: str,
    offset: int = 0,
) -> tuple[str, int, int]:
    """Read only new calibration log output starting at byte offset."""

    calibration_dir = CALIBRATION_ROOT / calibration_id
    log_file = calibration_dir / "calibration.log"

    if not calibration_dir.exists():
        raise FileNotFoundError(
            f"Calibration not found: {calibration_id}"
        )

    if not log_file.exists():
        return "", offset, 0

    size = log_file.stat().st_size

    # If the file was replaced/truncated, start over.
    if offset > size:
        offset = 0

    with log_file.open(
        "r",
        encoding="utf-8",
        errors="replace",
    ) as handle:
        handle.seek(offset)
        data = handle.read()
        new_offset = handle.tell()

    return data, new_offset, size
