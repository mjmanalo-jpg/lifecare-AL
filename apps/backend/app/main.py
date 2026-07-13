import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1 import camera, voice, ehr
from app.api.v1 import (
    ai_companion, call_bell, vitals, medications,
    schedule, messages, room_service, family, appointments,
)
from app.db import engine, close_db
from app.models.portal import Base


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await close_db()


app = FastAPI(
    title="Golden Hearth AI Assisted Care Backend",
    version="2.0.0",
    description="Resident Portal API — realtime, AI companion, clinical & family features",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://assisted-living-delta.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Existing routers
app.include_router(camera.router, prefix="/api/v1/camera", tags=["Camera"])
app.include_router(voice.router, prefix="/api/v1/voice", tags=["Voice"])
app.include_router(ehr.router, prefix="/api/v1/ehr", tags=["EHR"])

# Resident Portal routers
app.include_router(ai_companion.router, prefix="/api/v1/ai", tags=["AI Companion"])
app.include_router(call_bell.router, prefix="/api/v1/call-bell", tags=["Call Bell & SOS"])
app.include_router(vitals.router, prefix="/api/v1/vitals", tags=["Vitals"])
app.include_router(medications.router, prefix="/api/v1/medications", tags=["Medications"])
app.include_router(schedule.router, prefix="/api/v1/schedule", tags=["Daily Goals & Schedule"])
app.include_router(messages.router, prefix="/api/v1/messages", tags=["Messages"])
app.include_router(room_service.router, prefix="/api/v1/room-service", tags=["Room & Hotel Services"])
app.include_router(family.router, prefix="/api/v1/family", tags=["Family Portal"])
app.include_router(appointments.router, prefix="/api/v1/appointments", tags=["Appointments"])


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
