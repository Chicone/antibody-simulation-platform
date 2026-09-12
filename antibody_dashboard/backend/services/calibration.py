from __future__ import annotations

import json
import subprocess
import sys
import uuid
from pathlib import Path
import csv
import os

DASHBOARD_ROOT = Path(__file__).resolve().parents[2]
ABMD_ROOT = DASHBOARD_ROOT.parent

CALIBRATION_SCRIPT = (
    ABMD_ROOT
    / "scripts"
    / "calibrate_martini_en.py"
)

CALIBRATION_ROOT = (
    DASHBOARD_ROOT
    / "data"
    / "calibration_jobs"
)


def start_calibration(
    aa_job_id: str,
    duration_ns: float,
    nt: int,
    parallel: int,
    forces: str,
    lowers: str,
    uppers: str,
) -> dict:

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

    command = [
        sys.executable,
        str(CALIBRATION_SCRIPT),

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

        "--forces",
        forces,

        "--lowers",
        lowers,

        "--uppers",
        uppers,

        "--output-root",
        str(calibration_dir / "runs"),
    ]

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
        "aa_job_id": aa_job_id,
        "pid": process.pid,
        "duration_ns": duration_ns,
        "nt": nt,
        "parallel": parallel,
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

    total = (
        len(forces)
        * len(lowers)
        * len(uppers)
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

    successful.sort(
        key=lambda row: float(
            row.get("score") or "inf"
        )
    )

    top_results = []

    for row in successful[:10]:
        top_results.append(
            {
                "rank": len(top_results) + 1,
                "elastic_force": float(
                    row["elastic_force"]
                ),
                "elastic_lower": float(
                    row["elastic_lower"]
                ),
                "elastic_upper": float(
                    row["elastic_upper"]
                ),
                "score": float(
                    row["score"]
                ),
                "rmse_nm": float(
                    row["rmse_nm"]
                ),
                "pearson": float(
                    row["pearson"]
                ),
                "spearman": float(
                    row["spearman"]
                ),
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

    return {
        "calibration_id": calibration_id,
        "status": status,
        "completed": completed,
        "total": total,
        "progress_percent": progress,
        "successful": len(successful),
        "failed": completed - len(successful),
        "top_results": top_results,
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
