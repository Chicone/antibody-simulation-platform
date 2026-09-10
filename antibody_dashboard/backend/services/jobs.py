from __future__ import annotations

import os
import signal
import json
import shutil
from pathlib import Path
from typing import Optional
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo
import threading

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RUNS_DIR = PROJECT_ROOT / "data" / "runs"
RUNS_DIR.mkdir(parents=True, exist_ok=True)

def create_job(
    protein_file,
    method: str,
    duration_ns: float,
    name: str | None = None,
    model: str | None = None,
    elastic_force: float | None = None,
    elastic_lower: float | None = None,
    elastic_upper: float | None = None,
    salt_concentration: float = 0.15,
    temperature: float = 310.0,
    nt=8,
) -> dict:

    job_id = str(uuid.uuid4())
    directory = job_dir(job_id)

    input_dir = directory / "input"
    out_dir = directory / "out"

    input_dir.mkdir(parents=True, exist_ok=False)
    out_dir.mkdir(parents=True, exist_ok=True)

    protein_path = input_dir / "protein.pdb"

    protein_file.file.seek(0)
    with open(protein_path, "wb") as f:
        shutil.copyfileobj(protein_file.file, f)

    created_at = datetime.now(
        ZoneInfo("Europe/Paris")
    ).isoformat(timespec="seconds")

    run = {
        "job_id": job_id,
        "created_at": created_at,
        "protein": name or Path(protein_file.filename).stem,
        "protein_filename": protein_file.filename,
        "method": method,
        "model": model,
        "duration_ns": duration_ns,
        "elastic_force": elastic_force,
        "elastic_lower": elastic_lower,
        "elastic_upper": elastic_upper,
    }

    write_json(directory / "run.json", run)

    params = {
        "method": method,
        "duration_ns": duration_ns,
        "model": model,
        "elastic_force": elastic_force,
        "elastic_lower": elastic_lower,
        "elastic_upper": elastic_upper,
        "salt_concentration": salt_concentration,
        "temperature": temperature,
        "nt": nt,
    }

    write_json(
        input_dir / "params.json",
        params,
    )

    # New jobs enter the queue before the background worker starts.
    write_json(
        directory / "status.json",
        {"status": "queued"},
    )

    (directory / "log.txt").write_text(
        "Job created.\n",
        encoding="utf-8",
    )

    # Launch THIS newly created job.
    launch_job(job_id)

    return run

def launch_job(job_id: str) -> None:
    directory = job_dir(job_id)

    if not directory.exists():
        raise FileNotFoundError(job_id)

    run_data = read_json(directory / "run.json")

    write_json(
        directory / "status.json",
        {"status": "running"},
    )

    def worker():
        try:
            method = run_data.get("method")

            if method == "aa":
                from backend.pipelines.aa_pipeline import run_aa_pipeline
                run_aa_pipeline(directory)

            elif method == "martini":
                from backend.pipelines.martini_pipeline import run_martini_pipeline
                run_martini_pipeline(directory)
            else:
                raise RuntimeError(
                    f"Unknown simulation method: {method}"
                )

            # Do not mark an intentionally stopped run as completed.
            if (directory / "stop.requested").exists():
                raise RuntimeError("JOB_STOPPED")

            write_json(
                directory / "status.json",
                {"status": "done"},
            )


        except Exception as exc:
            stop_file = directory / "stop.requested"
            # A user-requested termination is not a simulation error.
            if stop_file.exists() or str(exc) == "JOB_STOPPED":
                with open(
                        directory / "log.txt",
                        "a",
                        encoding="utf-8",
                ) as f:
                    f.write("\nSimulation stopped by user.\n")
                write_json(
                    directory / "status.json",
                    {"status": "stopped"},
                )
            else:
                with open(
                        directory / "log.txt",
                        "a",
                        encoding="utf-8",
                ) as f:
                    f.write(f"\nERROR: {exc}\n")
                write_json(
                    directory / "status.json",
                    {
                        "status": "error",
                        "error": str(exc),
                    },
                )

    threading.Thread(
        target=worker,
        daemon=True,
    ).start()

def job_dir(job_id: str) -> Path:
    return RUNS_DIR / job_id


def read_json(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def get_job(job_id: str) -> Optional[dict]:
    directory = job_dir(job_id)

    run_file = directory / "run.json"
    status_file = directory / "status.json"

    if not run_file.exists():
        return None

    run = read_json(run_file)

    if status_file.exists():
        try:
            status = read_json(status_file)
            run["status"] = status.get("status", "unknown")
        except Exception:
            run["status"] = "unknown"
    else:
        run["status"] = "unknown"

    return run


def list_jobs(limit: int = 20) -> list[dict]:
    jobs = []

    if not RUNS_DIR.exists():
        return jobs

    for directory in RUNS_DIR.iterdir():
        if not directory.is_dir():
            continue

        job = get_job(directory.name)

        if job is not None:
            jobs.append(job)

    jobs.sort(
        key=lambda item: item.get("created_at", ""),
        reverse=True,
    )

    if limit > 0:
        jobs = jobs[:limit]

    return jobs

def stop_job(job_id: str) -> bool:
    """Stop the currently running simulation."""

    directory = job_dir(job_id)

    if not directory.exists():
        return False

    pid_file = directory / "current_process.json"
    stop_file = directory / "stop.requested"

    # Record that the stop was explicitly requested by the user.
    stop_file.write_text(
        "stop requested\n",
        encoding="utf-8",
    )

    write_json(
        directory / "status.json",
        {"status": "stopping"},
    )

    if pid_file.exists():
        try:
            data = read_json(pid_file)
            pid = int(data["pid"])

            # Terminate the complete GROMACS process group.
            os.killpg(pid, signal.SIGTERM)

        except ProcessLookupError:
            pass

        except Exception as exc:
            with open(
                directory / "log.txt",
                "a",
                encoding="utf-8",
            ) as f:
                f.write(
                    f"\nCould not terminate process cleanly: {exc}\n"
                )

            return False

    # The stop request has been issued successfully.
    # Mark it stopped rather than leaving the UI indefinitely at STOPPING.
    write_json(
        directory / "status.json",
        {"status": "stopped"},
    )

    with open(
        directory / "log.txt",
        "a",
        encoding="utf-8",
    ) as f:
        f.write("\nSimulation stopped by user.\n")

    return True

def delete_job(job_id: str) -> bool:
    directory = job_dir(job_id)

    if not directory.exists():
        return False

    shutil.rmtree(directory)
    return True


def read_log(job_id: str, offset: int = 0):
    path = job_dir(job_id) / "log.txt"

    if not path.exists():
        return b"", 0, 0

    size = path.stat().st_size
    offset = min(offset, size)

    with open(path, "rb") as f:
        f.seek(offset)
        data = f.read()

    return data, offset + len(data), size


def list_job_files(job_id: str):
    out_dir = job_dir(job_id) / "out"

    if not out_dir.exists():
        return []

    files = []

    for path in out_dir.rglob("*"):
        if path.is_file():
            files.append(
                {
                    "name": path.relative_to(out_dir).as_posix(),
                    "size": path.stat().st_size,
                }
            )

    return sorted(files, key=lambda x: x["name"])