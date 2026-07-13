import uuid
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, and_, func
from app.db import get_db
from app.auth import get_current_user
from app.models.portal import VitalsLog, Resident
from app.schemas.portal import VitalsCreate, VitalsOut, VitalsTrend
from app.realtime import manager

router = APIRouter()

VITALS_UNITS = {
    "BLOOD_PRESSURE": "mmHg",
    "HEART_RATE": "bpm",
    "TEMPERATURE": "°F",
    "OXYGEN": "%",
    "BLOOD_GLUCOSE": "mg/dL",
    "WEIGHT": "lbs",
    "RESPIRATORY_RATE": "breaths/min",
}


@router.post("", response_model=VitalsOut)
async def record_vitals(payload: VitalsCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Resident).where(Resident.id == payload.residentId))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Resident not found")

    vitals = VitalsLog(
        id=str(uuid.uuid4()),
        residentId=payload.residentId,
        type=payload.type,
        value=payload.value,
        unit=payload.unit or VITALS_UNITS.get(payload.type, ""),
        recordedAt=payload.recordedAt or datetime.utcnow(),
        recordedBy=payload.recordedBy,
        notes=payload.notes,
        createdAt=datetime.utcnow(),
        updatedAt=datetime.utcnow(),
    )
    db.add(vitals)
    await db.flush()

    await manager.broadcast(f"vitals:{payload.residentId}", {
        "type": "VITALS_RECORDED",
        "data": {
            "id": vitals.id,
            "type": vitals.type,
            "value": vitals.value,
            "unit": vitals.unit,
            "recordedAt": vitals.recordedAt.isoformat(),
        },
    })

    await db.commit()
    return VitalsOut(
        id=vitals.id,
        residentId=vitals.residentId,
        type=vitals.type,
        value=vitals.value,
        unit=vitals.unit,
        recordedAt=vitals.recordedAt,
        recordedBy=vitals.recordedBy,
        notes=vitals.notes,
        createdAt=vitals.createdAt,
    )


@router.get("/{resident_id}", response_model=list[VitalsOut])
async def get_vitals(
    resident_id: str,
    vital_type: Optional[str] = Query(None),
    days: int = Query(7, ge=1, le=90),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    query = select(VitalsLog).where(VitalsLog.residentId == resident_id)
    if vital_type:
        query = query.where(VitalsLog.type == vital_type)

    from datetime import timedelta
    since = datetime.utcnow() - timedelta(days=days)
    query = query.where(VitalsLog.recordedAt >= since)
    query = query.order_by(desc(VitalsLog.recordedAt)).limit(limit)

    result = await db.execute(query)
    vitals = result.scalars().all()
    return [VitalsOut.model_validate(v) for v in vitals]


@router.get("/{resident_id}/latest", response_model=dict)
async def get_latest_vitals(resident_id: str, db: AsyncSession = Depends(get_db)):
    subq = (
        select(
            VitalsLog.type,
            func.max(VitalsLog.recordedAt).label("max_time"),
        )
        .where(VitalsLog.residentId == resident_id)
        .group_by(VitalsLog.type)
    ).subquery()

    result = await db.execute(
        select(VitalsLog).join(
            subq,
            and_(
                VitalsLog.type == subq.c.type,
                VitalsLog.recordedAt == subq.c.max_time,
            ),
        )
    )
    latest = {}
    for v in result.scalars().all():
        latest[v.type] = {
            "value": v.value,
            "unit": v.unit,
            "recordedAt": v.recordedAt.isoformat(),
            "recordedBy": v.recordedBy,
        }
    return {"residentId": resident_id, "latest": latest}


@router.get("/{resident_id}/trend", response_model=list[VitalsTrend])
async def get_vitals_trend(
    resident_id: str,
    vital_type: str,
    days: int = Query(30, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
):
    from datetime import timedelta
    since = datetime.utcnow() - timedelta(days=days)

    result = await db.execute(
        select(VitalsLog)
        .where(
            VitalsLog.residentId == resident_id,
            VitalsLog.type == vital_type,
            VitalsLog.recordedAt >= since,
        )
        .order_by(VitalsLog.recordedAt)
    )
    readings = [VitalsOut.model_validate(v) for v in result.scalars().all()]
    return [VitalsTrend(type=vital_type, readings=readings)]
