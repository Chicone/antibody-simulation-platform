from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import Response

from backend.services.jobs import (
    create_job,
    delete_job,
    stop_job,
    get_job,
    list_job_files,
    list_jobs,
    read_log,
)


router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("")
def get_jobs(limit: int = Query(20, ge=0)):
    return list_jobs(limit)


@router.get("/{job_id}")
def get_job_info(job_id: str):
    job = get_job(job_id)

    if job is None:
        raise HTTPException(
            status_code=404,
            detail="Job not found",
        )

    return job


@router.get("/{job_id}/log")
def get_job_log(
    job_id: str,
    offset: int = Query(0, ge=0),
):
    data, new_offset, size = read_log(job_id, offset)

    return Response(
        content=data,
        media_type="text/plain",
        headers={
            "X-Log-Offset": str(new_offset),
            "X-Log-Size": str(size),
        },
    )


@router.get("/{job_id}/files")
def get_job_files(job_id: str):
    return {
        "files": list_job_files(job_id)
    }


@router.delete("/{job_id}")
def remove_job(job_id: str):
    if not delete_job(job_id):
        raise HTTPException(
            status_code=404,
            detail="Job not found",
        )

    return {
        "status": "deleted",
        "job_id": job_id,
    }

@router.post("/{job_id}/stop")
def stop_simulation_job(job_id: str):
    """Safely stop the currently running simulation."""

    if not stop_job(job_id):
        raise HTTPException(
            status_code=400,
            detail="Could not stop job",
        )

    return {
        "status": "stopping",
        "job_id": job_id,
    }

@router.post("")
async def create_simulation_job(
    protein_pdb: UploadFile = File(...),
    method: str = Form(...),
    duration_ns: float = Form(...),
    name: str | None = Form(None),
    model: str | None = Form(None),
    elastic_force: float | None = Form(None),
    elastic_lower: float | None = Form(None),
    elastic_upper: float | None = Form(None),
    salt_concentration: float = Form(0.15),
    temperature: float = Form(310.0)
):
    if method not in {"aa", "martini"}:
        raise HTTPException(
            status_code=400,
            detail="method must be 'aa' or 'martini'",
        )

    if duration_ns <= 0:
        raise HTTPException(
            status_code=400,
            detail="duration_ns must be > 0",
        )

    return create_job(
        protein_file=protein_pdb,
        method=method,
        duration_ns=duration_ns,
        name=name,
        model=model,
        elastic_force=elastic_force,
        elastic_lower=elastic_lower,
        elastic_upper=elastic_upper,
        salt_concentration=salt_concentration,
        temperature=temperature,
    )