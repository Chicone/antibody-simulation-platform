from fastapi import (
    APIRouter,
    Form,
    HTTPException,
    Query,
)
from fastapi.responses import Response

from backend.services.calibration import (
    start_calibration,
    get_calibration_status,
    read_calibration_log,
)


router = APIRouter(
    prefix="/api/calibration",
    tags=["calibration"],
)


@router.post("")
def create_calibration(
    aa_job_id: str = Form(...),
    duration_ns: float = Form(4.63),
    nt: int = Form(4),
    parallel: int = Form(2),
    forces: str = Form(
        "100,200,300,400,500,600,700,800"
    ),
    lowers: str = Form("0.4,0.5"),
    uppers: str = Form("0.7,0.8,0.9"),
):
    try:
        return start_calibration(
            aa_job_id=aa_job_id,
            duration_ns=duration_ns,
            nt=nt,
            parallel=parallel,
            forces=forces,
            lowers=lowers,
            uppers=uppers,
        )

    except FileNotFoundError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

@router.get("/{calibration_id}/status")
def calibration_status(
    calibration_id: str,
):
    try:
        return get_calibration_status(
            calibration_id
        )

    except FileNotFoundError as error:
        raise HTTPException(
            status_code=404,
            detail=str(error),
        )

@router.get("/{calibration_id}/log")
def calibration_log(
    calibration_id: str,
    offset: int = Query(0, ge=0),
):
    try:
        data, new_offset, size = read_calibration_log(
            calibration_id,
            offset,
        )
    except FileNotFoundError as error:
        raise HTTPException(
            status_code=404,
            detail=str(error),
        )

    return Response(
        content=data,
        media_type="text/plain",
        headers={
            "X-Log-Offset": str(new_offset),
            "X-Log-Size": str(size),
        },
    )
