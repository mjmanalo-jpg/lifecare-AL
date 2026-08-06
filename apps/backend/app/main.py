import uvicorn
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1 import camera, voice, ehr
from app.api.v1 import (
    ai_companion, call_bell, vitals, medications,
    schedule, messages, room_service, family, appointments,
)
from app.db import engine, close_db
from app.models.portal import Base
from app.auth import get_current_user


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Prisma migrations are the production schema authority. create_all remains
    # an explicit local-development escape hatch only.
    if os.getenv("AUTO_CREATE_SCHEMA", "false").lower() == "true" and os.getenv("PYTHON_ENV") != "production":
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    # Always-on, server-side fall monitoring — runs for as long as this process is
    # up, independent of any logged-in nurse or open browser tab.
    try:
        from app.services.fall_watchdog import start_watchdog
        start_watchdog()
    except Exception as e:
        print(f"[Watchdog] failed to start: {e}")
    yield
    try:
        from app.services.fall_watchdog import stop_watchdog
        stop_watchdog()
    except Exception:
        pass
    await close_db()


app = FastAPI(
    title="Golden Hearth AI Assisted Care Backend",
    version="2.0.0",
    description="Resident Portal API — realtime, AI companion, clinical & family features",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:3001").split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Existing routers
app.include_router(camera.router, prefix="/api/v1/camera", tags=["Camera"], dependencies=[Depends(get_current_user)])
app.include_router(voice.router, prefix="/api/v1/voice", tags=["Voice"], dependencies=[Depends(get_current_user)])
app.include_router(ehr.router, prefix="/api/v1/ehr", tags=["EHR"], dependencies=[Depends(get_current_user)])

# Resident Portal routers
app.include_router(ai_companion.router, prefix="/api/v1/ai", tags=["AI Companion"], dependencies=[Depends(get_current_user)])
app.include_router(call_bell.router, prefix="/api/v1/call-bell", tags=["Call Bell & SOS"], dependencies=[Depends(get_current_user)])
app.include_router(vitals.router, prefix="/api/v1/vitals", tags=["Vitals"], dependencies=[Depends(get_current_user)])
app.include_router(medications.router, prefix="/api/v1/medications", tags=["Medications"], dependencies=[Depends(get_current_user)])
app.include_router(schedule.router, prefix="/api/v1/schedule", tags=["Daily Goals & Schedule"], dependencies=[Depends(get_current_user)])
app.include_router(messages.router, prefix="/api/v1/messages", tags=["Messages"], dependencies=[Depends(get_current_user)])
app.include_router(room_service.router, prefix="/api/v1/room-service", tags=["Room & Hotel Services"], dependencies=[Depends(get_current_user)])
app.include_router(family.router, prefix="/api/v1/family", tags=["Family Portal"], dependencies=[Depends(get_current_user)])
app.include_router(appointments.router, prefix="/api/v1/appointments", tags=["Appointments"], dependencies=[Depends(get_current_user)])


@app.get("/")
def read_root():
    return {"status": "ONLINE", "service": "Golden Hearth Core Backend", "version": "2.0.0"}


@app.get("/health")
async def health_check():
    return {"status": "healthy", "features": [
        "ai_companion", "call_bell", "vitals", "medications",
        "schedule", "messages", "room_service", "family", "appointments",
    ]}


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
