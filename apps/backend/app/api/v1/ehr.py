from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

router = APIRouter()

class ResidentProfile(BaseModel):
    id: str
    name: str
    room: str
    care_level: str
    vitals_summary: Optional[str] = "Normal"
    last_sync: datetime = datetime.now()

@router.get("/residents", response_model=List[ResidentProfile])
def get_residents():
    # Return mock sync records from local database
    return [
        ResidentProfile(id="res-001", name="Arthur Pendelton", room="Room 12A", care_level="Assisted"),
        ResidentProfile(id="res-002", name="Margot Channing", room="Room 14B", care_level="Memory Care"),
        ResidentProfile(id="res-003", name="Caleb R.", room="Room 03", care_level="Independent")
    ]
