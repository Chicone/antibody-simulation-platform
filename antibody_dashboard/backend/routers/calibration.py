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
    get_calibration_results,
    get_calibration_gp_surface,
    list_calibrations,
    delete_calibration,
    read_calibration_log,
)


router = APIRouter(
    prefix="/api/calibration",
    tags=["calibration"],
)


@router.get("")
def get_calibrations(
    limit: int = Query(20, ge=0),
):
    return list_calibrations(limit)


@router.post("")
def create_calibration(
    aa_job_id: str = Form(...),
    duration_ns: float = Form(4.63),
    nt: int = Form(4),
    parallel: int = Form(2),
    replicas: int = Form(1),
    forces: str = Form(
        "100,200,300,400,500,600,700,800"
    ),
    lowers: str = Form("0.4,0.5"),
    uppers: str = Form("0.7,0.8,0.9"),
    model: str = Form("elastic"),
    epsilons: str = Form("6,8,9.414,11,13"),
):
    try:
        return start_calibration(
            aa_job_id=aa_job_id,
            duration_ns=duration_ns,
            nt=nt,
            parallel=parallel,
            replicas=replicas,
            forces=epsilons if model == "go" else forces,
            lowers=lowers,
            uppers=uppers,
            model=model,
        )

    except (FileNotFoundError, ValueError) as error:
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

@router.delete("/{calibration_id}")
def remove_calibration(
    calibration_id: str,
):
    try:
        deleted = delete_calibration(calibration_id)
    except RuntimeError as error:
        raise HTTPException(
            status_code=409,
            detail=str(error),
        )

    if not deleted:
        raise HTTPException(
            status_code=404,
            detail="Calibration not found",
        )

    return {
        "status": "deleted",
        "calibration_id": calibration_id,
    }


@router.get("/{calibration_id}/results")
def calibration_results(
    calibration_id: str,
):
    try:
        return get_calibration_results(
            calibration_id
        )

    except FileNotFoundError as error:
        raise HTTPException(
            status_code=404,
            detail=str(error),
        )


@router.get("/{calibration_id}/gp")
def calibration_gp(
    calibration_id: str,
    x_param: str = Query("elastic_force"),
    y_param: str = Query("elastic_lower"),
    fixed_param: str = Query("elastic_upper"),
    fixed_value: float = Query(0.9),
    metric: str = Query("score"),
    resolution: int = Query(30, ge=12, le=60),
):
    try:
        return get_calibration_gp_surface(
            calibration_id,
            x_param=x_param,
            y_param=y_param,
            fixed_param=fixed_param,
            fixed_value=fixed_value,
            metric=metric,
            resolution=resolution,
        )
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error))


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
