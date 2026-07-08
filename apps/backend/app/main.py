import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1 import camera, voice, ehr

app = FastAPI(
    title="Golden Hearth AI Assisted Care Backend",
    version="1.0.0",
    description="Python FastAPI service for OpenCV optical matrix and LLM integrations"
)

# Enable CORS for Next.js app
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://assisted-living-delta.vercel.app"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(camera.router, prefix="/api/v1/camera", tags=["Camera"])
app.include_router(voice.router, prefix="/api/v1/voice", tags=["Voice"])
app.include_router(ehr.router, prefix="/api/v1/ehr", tags=["EHR"])

@app.get("/")
def read_root():
    return {"status": "ONLINE", "service": "Golden Hearth Core Backend"}

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
