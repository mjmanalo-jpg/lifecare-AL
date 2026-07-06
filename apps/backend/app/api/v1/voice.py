from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

class TranscribeRequest(BaseModel):
    audio_base64: str
    staff_id: str

@router.post("/transcribe")
def transcribe_audio(payload: TranscribeRequest):
    if not payload.audio_base64:
        raise HTTPException(status_code=400, detail="Invalid audio payload")
    
    # Mock voice synthesis transcription NLP output
    return {
        "status": "success",
        "transcription": "Resident Arthur Pendelton was guided back to bed. Vitals normal. Complied with medication checklist.",
        "confidence": 0.96,
        "parsed_entities": {
            "resident": "Arthur Pendelton",
            "action": "Guided to bed",
            "medication_status": "Complied"
        }
    }
