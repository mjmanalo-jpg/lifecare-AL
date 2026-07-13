import json
import re
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.db import get_db
from app.auth import get_current_user
from app.models.portal import AiChatMessage, Resident, CallBell, Visit, KnowledgeDoc
from app.schemas.portal import AiChatRequest, AiVoiceRequest, AiChatResponse, AiChatHistory
from app.realtime import manager

router = APIRouter()

# ── Multilingual Intent Keywords ─────────────────────────────────────────────

INTENT_KEYWORDS = {
    "emergency": {
        "en": ["help", "emergency", "sos", "dizzy", "fall", "pain", "hurt", "cant breathe", "chest", "bleeding", "faint"],
        "tl": ["tulong", "emergency", "sakit", "nahilo", "nahulog", "dugo", "hirap huminga", "puso"],
        "bis": ["tabang", "emergency", "sakit", "nahilo", "nahulog", "dugo", "lisod ginhawa", "kasingkasing"],
    },
    "visit_request": {
        "en": ["visit", "daughter", "son", "family", "coming to see", "schedule a visit", "visitor", "seeing me"],
        "tl": ["bisita", "anak", "pamilya", "pupunta", "makikita"],
        "bis": ["bisita", "anak", "pamilya", "mou", "makita"],
    },
    "appointment_view": {
        "en": ["appointment", "doctor", "schedule", "when is my", "next appointment", "checkup"],
        "tl": ["appointment", "doktor", "iskedyul", "kailan", "susunod"],
        "bis": ["appointment", "doktor", "iskedyul", "kanus-a", "sunod"],
    },
    "medication_query": {
        "en": ["medication", "medicine", "pill", "drug", "prescription", "my meds", "what do i take"],
        "tl": ["gamot", "pills", "reseta", "iniinom"],
        "bis": ["tambal", "pills", "reseta", "gikuon"],
    },
    "vitals_query": {
        "en": ["vitals", "blood pressure", "heart rate", "temperature", "oxygen", "weight", "my vitals", "how am i"],
        "tl": ["presyon ng dugo", "tibok ng puso", "temperatura", "oxygen", "timbang"],
        "bis": ["presyon sa dugo", "kasingkasing", "temperatura", "oxygen", "timbang"],
    },
    "room_service": {
        "en": ["food", "meal", "room service", "hungry", "water", "snack", "drink", "menu", "breakfast", "lunch", "dinner"],
        "tl": ["pagkain", "kain", "gutom", "tubig", "merienda", "almusal", "tanghalian", "hapunan"],
        "bis": ["kaon", "pagkaon", "gutom", "tubig", "snack", "pamahaw", "paniudto", "panihapon"],
    },
    "daily_schedule": {
        "en": ["today", "schedule", "what's today", "goals", "activities", "what am i doing"],
        "tl": ["ngayon", "iskedyul", "gawain", "plano", "aktibidad"],
        "bis": ["karon", "iskedyul", "buhaton", "plano", "aktibidad"],
    },
}


def classify_intent(text: str) -> tuple[str, str]:
    lower = text.lower().strip()
    for intent, langs in INTENT_KEYWORDS.items():
        for lang_code, keywords in langs.items():
            for kw in keywords:
                if kw in lower:
                    return intent, lang_code
    return "general_chat", "en"


def extract_visit_entities(text: str) -> dict:
    entities = {}
    lower = text.lower()
    day_match = re.search(
        r"(monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
        r"lunes|martes|mierkules|huwebes|biyernes|sabado|linggo|"
        r"lunes|martes|mierkules|huwebes|biyernes|sabado|domingo)",
        lower,
    )
    if day_match:
        entities["day"] = day_match.group(1)
    person_match = re.search(
        r"(my\s+)?(daughter|son|wife|husband|mother|father|sister|brother|family|friend|"
        r"anak|asawa|nanay|tatay|kapatid|pamilya|kapatid)",
        lower,
    )
    if person_match:
        entities["person"] = person_match.group(2)
    return entities


async def generate_ai_response(resident_id: str, message: str, language: str, db: AsyncSession) -> AiChatResponse:
    intent, detected_lang = classify_intent(message)
    lang = language or detected_lang

    resident_result = await db.execute(select(Resident).where(Resident.id == resident_id))
    resident = resident_result.scalar_one_or_none()
    resident_name = f"{resident.firstName}" if resident else "there"

    actions = []
    deep_link = None
    reply = ""

    if intent == "emergency":
        reason = f"AI-detected emergency from resident: {message[:200]}"
        call_bell = CallBell(
            id=str(__import__("uuid").uuid4()),
            residentId=resident_id,
            status="PENDING",
            reason=reason,
            createdAt=datetime.utcnow(),
            updatedAt=datetime.utcnow(),
        )
        db.add(call_bell)
        await db.flush()
        actions.append({"type": "call_bell_triggered", "callBellId": call_bell.id})
        await manager.broadcast("call-bell", {
            "type": "NEW_CALL_BELL",
            "data": {
                "id": call_bell.id,
                "residentId": resident_id,
                "residentName": f"{resident.firstName} {resident.lastName}" if resident else "Unknown",
                "roomNumber": resident.roomNumber if resident else "?",
                "reason": reason,
                "status": "PENDING",
                "createdAt": call_bell.createdAt.isoformat(),
            },
        })
        replies = {
            "en": f"I've alerted the care team right away, {resident_name}. Help is on the way. Please stay calm.",
            "tl": f"Ni-alert na ako ang care team, {resident_name}. Paparating na ang tulong. Manatili kang kalmado.",
            "bis": f"Gipahibalo na nako ang care team, {resident_name}. Moabot na ang tabang. Palihog kalmado lang.",
        }
        reply = replies.get(lang, replies["en"])
        deep_link = "/resident/call-bell"

    elif intent == "visit_request":
        entities = extract_visit_entities(message)
        day = entities.get("day", "this week")
        person = entities.get("person", "your family")
        replies = {
            "en": f"I've noted your request to see {person} on {day}. I'll save this for the care team to coordinate.",
            "tl": f"Nailagay ko ang request mong makita ang {person} sa {day}. Ise-save ko ito para i-coordinate ng care team.",
            "bis": f"Gitigum nako ang imong hangyo nga makita si {person} sa {day}. I-save ko kini para i-coordinate sa care team.",
        }
        reply = replies.get(lang, replies["en"]).replace("{person}", person).replace("{day}", day)
        actions.append({"type": "visit_request_saved", "entities": entities})
        deep_link = "/resident/schedule"

    elif intent == "appointment_view":
        reply = f"Let me pull up your upcoming appointments, {resident_name}."
        if lang == "tl":
            reply = f"Hinuhugot ko ang iyong mga paparating na appointment, {resident_name}."
        elif lang == "bis":
            reply = f"Kuhaon nako ang imong mga umaabot nga appointment, {resident_name}."
        deep_link = "/resident/schedule?tab=appointments"
        actions.append({"type": "show_appointments"})

    elif intent == "medication_query":
        reply = f"Here are your current medications, {resident_name}. Let me show you the full list."
        if lang == "tl":
            reply = f"Narito ang iyong mga kasalukuyang gamot, {resident_name}. Ipapakita ko ang buong listahan."
        elif lang == "bis":
            reply = f"Mao kini ang imong kasamtangang mga tambal, {resident_name}. Ipakita nako ang tibuok listahan."
        deep_link = "/resident/medications"
        actions.append({"type": "show_medications"})

    elif intent == "vitals_query":
        reply = f"Let me check your latest vitals, {resident_name}."
        if lang == "tl":
            reply = f"Tinitingnan ko ang iyong latest na vital signs, {resident_name}."
        elif lang == "bis":
            reply = f"Tan-awon nako ang imong latest nga vital signs, {resident_name}."
        deep_link = "/resident/vitals"
        actions.append({"type": "show_vitals"})

    elif intent == "room_service":
        reply = f"I'll help arrange that, {resident_name}. What would you like?"
        if lang == "tl":
            reply = f"Tutulungan ko iyan, {resident_name}. Ano ang gusto mo?"
        elif lang == "bis":
            reply = f"Tabangan ko ka niya, {resident_name}. Unsa ang gusto nimo?"
        deep_link = "/resident/room-service"
        actions.append({"type": "show_room_service"})

    elif intent == "daily_schedule":
        reply = f"Here's what's on your schedule today, {resident_name}."
        if lang == "tl":
            reply = f"Narito ang naka-iskedyul para sa iyo ngayon, {resident_name}."
        elif lang == "bis":
            reply = f"Mao kini ang imong iskedyul karon, {resident_name}."
        deep_link = "/resident/schedule"
        actions.append({"type": "show_schedule"})

    else:
        greetings = {
            "en": [
                f"Hello {resident_name}! How can I help you today?",
                f"Hi {resident_name}! What would you like to know?",
                f"Good day, {resident_name}! I'm here for you.",
            ],
            "tl": [
                f"Kumusta {resident_name}! Paano kita matutulungan ngayon?",
                f"Kamusta {resident_name}! Ano ang gusto mong malaman?",
            ],
            "bis": [
                f"Kumusta {resident_name}! Unsaon nako ikatabang karon?",
                f"Kamusta {resident_name}! Unsa ang gusto nimong mahibal-an?",
            ],
        }
        import random
        reply = random.choice(greetings.get(lang, greetings["en"]))

    return AiChatResponse(
        reply=reply,
        intent=intent,
        language=lang,
        actions=actions,
        deepLink=deep_link,
    )


@router.post("/chat", response_model=AiChatResponse)
async def chat(request: AiChatRequest, db: AsyncSession = Depends(get_db)):
    user_msg = AiChatMessage(
        residentId=request.residentId,
        role="user",
        content=request.message,
        language=request.language,
        createdAt=datetime.utcnow(),
    )
    db.add(user_msg)

    response = await generate_ai_response(request.residentId, request.message, request.language, db)

    assistant_msg = AiChatMessage(
        residentId=request.residentId,
        role="assistant",
        content=response.reply,
        language=response.language,
        intent=response.intent,
        metadata=json.dumps({"actions": response.actions, "deepLink": response.deepLink}),
        createdAt=datetime.utcnow(),
    )
    db.add(assistant_msg)
    await db.commit()
    return response


@router.post("/voice", response_model=AiChatResponse)
async def voice_chat(request: AiVoiceRequest, db: AsyncSession = Depends(get_db)):
    return await generate_ai_response(request.residentId, request.audio_base64, request.language, db)


@router.get("/history/{resident_id}", response_model=list[AiChatHistory])
async def get_chat_history(resident_id: str, limit: int = 50, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AiChatMessage)
        .where(AiChatMessage.residentId == resident_id)
        .order_by(desc(AiChatMessage.createdAt))
        .limit(limit)
    )
    messages = result.scalars().all()
    return [AiChatHistory.model_validate(m) for m in reversed(messages)]


@router.websocket("/ws/{user_id}")
async def ai_companion_ws(websocket: WebSocket, user_id: str):
    await manager.connect(websocket, f"ai-companion:{user_id}", user_id)
    try:
        while True:
            data = await websocket.receive_json()
            message = data.get("message", "")
            language = data.get("language", "en")
            resident_id = data.get("residentId", user_id)

            from app.db import AsyncSessionLocal
            async with AsyncSessionLocal() as db:
                response = await generate_ai_response(resident_id, message, language, db)
                await db.commit()

            await websocket.send_json({
                "type": "AI_RESPONSE",
                "data": response.model_dump(),
            })
    except WebSocketDisconnect:
        manager.disconnect(websocket, f"ai-companion:{user_id}", user_id)
