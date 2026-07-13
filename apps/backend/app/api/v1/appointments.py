import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.db import get_db
from app.auth import get_current_user
from app.models.portal import TransportRequest, Resident
from app.schemas.portal import AppointmentCreate, AppointmentOut

router = APIRouter()


@router.get("/{resident_id}", response_model=list[AppointmentOut])
async def get_appointments(
    resident_id: str,
    status: str = Query(None),
    upcoming_only: bool = Query(False),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    query = select(TransportRequest).where(TransportRequest.residentId == resident_id)
    if status:
        query = query.where(TransportRequest.status == status)
    if upcoming_only:
        query = query.where(TransportRequest.requestedDate >= datetime.utcnow())
    query = query.order_by(TransportRequest.requestedDate).limit(limit)
    result = await db.execute(query)
    return [AppointmentOut.model_validate(a) for a in result.scalars().all()]


@router.post("", response_model=AppointmentOut)
async def create_appointment(payload: AppointmentCreate, db: AsyncSession = Depends(get_db)):
    res_r = await db.execute(select(Resident).where(Resident.id == payload.residentId))
    if not res_r.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Resident not found")

    appt = TransportRequest(
        id=str(uuid.uuid4()),
        residentId=payload.residentId,
        type=payload.type,
        destination=payload.destination,
        purpose=payload.purpose,
        requestedDate=payload.requestedDate,
        returnRequired=payload.returnRequired,
        wheelchairNeeded=payload.wheelchairNeeded,
        escortRequired=payload.escortRequired,
        escortRole=payload.escortRole,
        priority=payload.priority,
        status="PENDING",
        source="PORTAL",
        notes=payload.notes,
        createdAt=datetime.utcnow(),
        updatedAt=datetime.utcnow(),
    )
    db.add(appt)
    await db.commit()
    await db.refresh(appt)
    return AppointmentOut.model_validate(appt)


@router.get("/{appointment_id}", response_model=AppointmentOut)
async def get_appointment(appointment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TransportRequest).where(TransportRequest.id == appointment_id))
    appt = result.scalar_one_or_none()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    return AppointmentOut.model_validate(appt)


@router.put("/{appointment_id}/cancel", response_model=AppointmentOut)
async def cancel_appointment(appointment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TransportRequest).where(TransportRequest.id == appointment_id))
    appt = result.scalar_one_or_none()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    if appt.status in ("COMPLETED", "CANCELLED"):
        raise HTTPException(status_code=400, detail="Cannot cancel completed or already cancelled appointment")

    appt.status = "CANCELLED"
    appt.updatedAt = datetime.utcnow()
    await db.commit()
    await db.refresh(appt)
    return AppointmentOut.model_validate(appt)
