import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.db import get_db
from app.auth import get_current_user
from app.models.portal import Medication, Resident
from app.schemas.portal import MedicationCreate, MedicationUpdate, MedicationOut

router = APIRouter()


@router.get("/{resident_id}", response_model=list[MedicationOut])
async def get_medications(
    resident_id: str,
    status: str = Query(None),
    db: AsyncSession = Depends(get_db),
):
    query = select(Medication).where(Medication.residentId == resident_id)
    if status:
        query = query.where(Medication.status == status)
    query = query.order_by(desc(Medication.createdAt))
    result = await db.execute(query)
    meds = result.scalars().all()
    return [MedicationOut.model_validate(m) for m in meds]


@router.post("", response_model=MedicationOut)
async def create_medication(payload: MedicationCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Resident).where(Resident.id == payload.residentId))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Resident not found")

    med = Medication(
        id=str(uuid.uuid4()),
        residentId=payload.residentId,
        name=payload.name,
        dosage=payload.dosage,
        frequency=payload.frequency,
        route=payload.route,
        status=payload.status,
        startDate=payload.startDate,
        endDate=payload.endDate,
        prescribedBy=payload.prescribedBy,
        reason=payload.reason,
        sideEffects=payload.sideEffects,
        contraindications=payload.contraindications,
        createdAt=datetime.utcnow(),
        updatedAt=datetime.utcnow(),
    )
    db.add(med)
    await db.commit()
    await db.refresh(med)
    return MedicationOut.model_validate(med)


@router.put("/{med_id}", response_model=MedicationOut)
async def update_medication(med_id: str, payload: MedicationUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Medication).where(Medication.id == med_id))
    med = result.scalar_one_or_none()
    if not med:
        raise HTTPException(status_code=404, detail="Medication not found")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(med, key, value)
    med.updatedAt = datetime.utcnow()

    await db.commit()
    await db.refresh(med)
    return MedicationOut.model_validate(med)


@router.put("/{med_id}/status", response_model=MedicationOut)
async def update_medication_status(med_id: str, status: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Medication).where(Medication.id == med_id))
    med = result.scalar_one_or_none()
    if not med:
        raise HTTPException(status_code=404, detail="Medication not found")

    valid = {"ACTIVE", "DISCONTINUED", "PENDING", "ON_HOLD"}
    if status not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid}")

    med.status = status
    if status == "DISCONTINUED":
        med.endDate = datetime.utcnow()
    med.updatedAt = datetime.utcnow()

    await db.commit()
    await db.refresh(med)
    return MedicationOut.model_validate(med)


@router.delete("/{med_id}")
async def delete_medication(med_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Medication).where(Medication.id == med_id))
    med = result.scalar_one_or_none()
    if not med:
        raise HTTPException(status_code=404, detail="Medication not found")
    await db.delete(med)
    await db.commit()
    return {"status": "deleted", "id": med_id}
