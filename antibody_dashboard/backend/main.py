from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routers.jobs import router as jobs_router


app = FastAPI(
    title="Antibody Simulation Platform",
    version="0.1.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(jobs_router)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "antibody-simulation-platform",
    }