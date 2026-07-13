import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func
from app.db import get_db
from app.auth import get_current_user
from app.models.portal import CallBell, Resident
from app.schemas.portal import (
    CallBellCreate, CallBellSOS, CallBellRespond,
    CallBellResolve, CallBellOut,
)
from app.realtime import manager

router = APIRouter()


def _call_bell_to_out(cb: CallBell, resident: Resident | None = None) -> dict:
    return {
        "id": cb.id,
        "residentId": cb.residentId,
        "residentName": f"{resident.firstName} {resident.lastName}" if resident else None,
        "roomNumber": resident.roomNumber if resident else None,
        "status": cb.status,
        "reason": cb.reason,
        "respondedAt": cb.respondedAt.isoformat() if cb.respondedAt else None,
        "resolvedAt": cb.resolvedAt.isoformat() if cb.resolvedAt else None,
        "notes": cb.notes,
        "createdAt": cb.createdAt.isoformat(),
    }


@router.post("", response_model=CallBellOut)
async def trigger_call_bell(payload: CallBellCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Resident).where(Resident.id == payload.residentId))
    resident = result.scalar_one_or_none()
    if not resident:
        raise HTTPException(status_code=404, detail="Resident not found")

    cb = CallBell(
        id=str(uuid.uuid4()),
        residentId=payload.residentId,
        status="PENDING",
        reason=payload.reason,
        createdAt=datetime.utcnow(),
        updatedAt=datetime.utcnow(),
    )
    db.add(cb)
    await db.flush()

    data = _call_bell_to_out(cb, resident)
    await manager.broadcast("call-bell", {"type": "NEW_CALL_BELL", "data": data})

    notif_result = await db.execute(
        select(Resident.userId).where(Resident.id == payload.residentId)
    )

    await db.commit()
    return CallBellOut(**data)


@router.post("/sos", response_model=CallBellOut)
async def trigger_sos(payload: CallBellSOS, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Resident).where(Resident.id == payload.residentId))
    resident = result.scalar_one_or_none()
    if not resident:
        raise HTTPException(status_code=404, detail="Resident not found")

    cb = CallBell(
        id=str(uuid.uuid4()),
        residentId=payload.residentId,
        status="PENDING",
        reason=f"EMERGENCY SOS: {payload.reason}",
        createdAt=datetime.utcnow(),
        updatedAt=datetime.utcnow(),
    )
    db.add(cb)
    await db.flush()

    data = _call_bell_to_out(cb, resident)
    await manager.broadcast("call-bell", {"type": "SOS_ALERT", "data": data})
    await manager.broadcast("nurses", {"type": "SOS_ALERT", "data": data})
    await db.commit()
    return CallBellOut(**data)


@router.get("/active", response_model=list[CallBellOut])
async def get_active_call_bells(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(CallBell)
        .where(CallBell.status.in_(["PENDING", "RESPONDED"]))
        .order_by(desc(CallBell.createdAt))
    )
    bells = result.scalars().all()
    out = []
    for cb in bells:
        res_result = await db.execute(select(Resident).where(Resident.id == cb.residentId))
        resident = res_result.scalar_one_or_none()
        out.append(CallBellOut(**_call_bell_to_out(cb, resident)))
    return out


@router.get("/{call_bell_id}", response_model=CallBellOut)
async def get_call_bell(call_bell_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CallBell).where(CallBell.id == call_bell_id))
    cb = result.scalar_one_or_none()
    if not cb:
        raise HTTPException(status_code=404, detail="Call bell not found")
    res_result = await db.execute(select(Resident).where(Resident.id == cb.residentId))
    resident = res_result.scalar_one_or_none()
    return CallBellOut(**_call_bell_to_out(cb, resident))


@router.put("/{call_bell_id}/respond", response_model=CallBellOut)
async def respond_to_call_bell(
    call_bell_id: str,
    payload: CallBellRespond,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(CallBell).where(CallBell.id == call_bell_id))
    cb = result.scalar_one_or_none()
    if not cb:
        raise HTTPException(status_code=404, detail="Call bell not found")
    if cb.status == "RESOLVED":
        raise HTTPException(status_code=400, detail="Call bell already resolved")

    cb.status = "RESPONDED"
    cb.respondedAt = datetime.utcnow()
    cb.notes = payload.notes or cb.notes
    cb.updatedAt = datetime.utcnow()
    await db.flush()

    res_result = await db.execute(select(Resident).where(Resident.id == cb.residentId))
    resident = res_result.scalar_one_or_none()
    data = _call_bell_to_out(cb, resident)

    await manager.broadcast("call-bell", {"type": "CALL_BELL_RESPONDED", "data": data})
    await manager.send_to_user(cb.residentId, {"type": "CALL_BELL_RESPONDED", "data": data})
    await db.commit()
    return CallBellOut(**data)


@router.put("/{call_bell_id}/resolve", response_model=CallBellOut)
async def resolve_call_bell(
    call_bell_id: str,
    payload: CallBellResolve,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(CallBell).where(CallBell.id == call_bell_id))
    cb = result.scalar_one_or_none()
    if not cb:
        raise HTTPException(status_code=404, detail="Call bell not found")

    cb.status = "RESOLVED"
    cb.resolvedAt = datetime.utcnow()
    cb.notes = payload.notes or cb.notes
    cb.updatedAt = datetime.utcnow()
    await db.flush()

    res_result = await db.execute(select(Resident).where(Resident.id == cb.residentId))
    resident = res_result.scalar_one_or_none()
    data = _call_bell_to_out(cb, resident)

    await manager.broadcast("call-bell", {"type": "CALL_BELL_RESOLVED", "data": data})
    await db.commit()
    return CallBellOut(**data)


@router.put("/{call_bell_id}/cancel", response_model=CallBellOut)
async def cancel_call_bell(call_bell_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CallBell).where(CallBell.id == call_bell_id))
    cb = result.scalar_one_or_none()
    if not cb:
        raise HTTPException(status_code=404, detail="Call bell not found")

    cb.status = "CANCELLED"
    cb.updatedAt = datetime.utcnow()
    await db.flush()

    res_result = await db.execute(select(Resident).where(Resident.id == cb.residentId))
    resident = res_result.scalar_one_or_none()
    data = _call_bell_to_out(cb, resident)

    await manager.broadcast("call-bell", {"type": "CALL_BELL_CANCELLED", "data": data})
    await db.commit()
    return CallBellOut(**data)


@router.websocket("/ws/call-bell")
async def call_bell_ws(websocket: WebSocket):
    await manager.connect(websocket, "call-bell")
    try:
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, "call-bell")


@router.websocket("/ws/nurses")
async def nurse_alerts_ws(websocket: WebSocket):
    await manager.connect(websocket, "nurses")
    try:
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, "nurses")
