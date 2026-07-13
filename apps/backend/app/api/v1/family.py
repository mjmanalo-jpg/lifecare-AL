import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, and_
from app.db import get_db
from app.auth import get_current_user
from app.models.portal import (
    Resident, User, VitalsLog, Medication, Task, CallBell,
    TransportRequest, Visit,
)
from app.schemas.portal import (
    FamilyResidentSummary, FamilyDashboard, VisitCreate, VisitOut,
    VitalsOut, MedicationOut, TaskOut, CallBellOut, AppointmentOut,
)

router = APIRouter()


@router.get("/{sponsor_id}/residents", response_model=list[FamilyResidentSummary])
async def get_sponsored_residents(sponsor_id: str, db: AsyncSession = Depends(get_db)):
    user_r = await db.execute(select(User).where(User.id == sponsor_id))
    user = user_r.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Family user not found")

    result = await db.execute(
        select(Resident).where(Resident.sponsorId == sponsor_id)
    )
    residents = result.scalars().all()
    return [
        FamilyResidentSummary(
            id=r.id,
            firstName=r.firstName,
            lastName=r.lastName,
            roomNumber=r.roomNumber,
            careLevel=r.careLevel,
            dateOfBirth=r.dateOfBirth,
            gender=r.gender,
        )
        for r in residents
    ]


@router.get("/{resident_id}/dashboard", response_model=FamilyDashboard)
async def get_family_dashboard(resident_id: str, db: AsyncSession = Depends(get_db)):
    res_r = await db.execute(select(Resident).where(Resident.id == resident_id))
    resident = res_r.scalar_one_or_none()
    if not resident:
        raise HTTPException(status_code=404, detail="Resident not found")

    vitals_r = await db.execute(
        select(VitalsLog)
        .where(VitalsLog.residentId == resident_id)
        .order_by(desc(VitalsLog.recordedAt))
        .limit(10)
    )
    vitals = [VitalsOut.model_validate(v) for v in vitals_r.scalars().all()]

    meds_r = await db.execute(
        select(Medication).where(
            Medication.residentId == resident_id,
            Medication.status == "ACTIVE",
        )
    )
    meds = [MedicationOut.model_validate(m) for m in meds_r.scalars().all()]

    tasks_r = await db.execute(
        select(Task).where(Task.residentId == resident_id)
        .order_by(Task.dueDate)
        .limit(10)
    )
    tasks = [TaskOut.model_validate(t) for t in tasks_r.scalars().all()]

    bells_r = await db.execute(
        select(CallBell).where(CallBell.residentId == resident_id)
        .order_by(desc(CallBell.createdAt))
        .limit(5)
    )
    bells = [CallBellOut(
        id=b.id, residentId=b.residentId, status=b.status, reason=b.reason,
        respondedAt=b.respondedAt, resolvedAt=b.resolvedAt, notes=b.notes,
        createdAt=b.createdAt,
    ) for b in bells_r.scalars().all()]

    appts_r = await db.execute(
        select(TransportRequest).where(
            TransportRequest.residentId == resident_id,
            TransportRequest.requestedDate >= datetime.utcnow(),
        )
        .order_by(TransportRequest.requestedDate)
        .limit(5)
    )
    appts = [AppointmentOut.model_validate(a) for a in appts_r.scalars().all()]

    unread_r = await db.execute(
        select(func.count(Notification.id)).where(
            Notification.userId == resident.userId,
            Notification.isRead == False,
        )
    ) if resident.userId else None

    from sqlalchemy import func as safunc
    if resident.userId:
        unread_r = await db.execute(
            select(safunc.count(Notification.id)).where(
                Notification.userId == resident.userId,
                Notification.isRead == False,
            )
        )
        unread = unread_r.scalar() or 0
    else:
        unread = 0

    return FamilyDashboard(
        resident=FamilyResidentSummary(
            id=resident.id,
            firstName=resident.firstName,
            lastName=resident.lastName,
            roomNumber=resident.roomNumber,
            careLevel=resident.careLevel,
            dateOfBirth=resident.dateOfBirth,
            gender=resident.gender,
        ),
        latestVitals=vitals,
        activeMedications=meds,
        todayTasks=tasks,
        recentCallBells=bells,
        upcomingAppointments=appts,
        unreadMessages=unread,
    )


@router.get("/{resident_id}/visits", response_model=list[VisitOut])
async def get_visits(resident_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Visit)
        .where(Visit.residentId == resident_id)
        .order_by(desc(Visit.checkInTime))
        .limit(20)
    )
    return [VisitOut.model_validate(v) for v in result.scalars().all()]


@router.post("/{resident_id}/visit", response_model=VisitOut)
async def schedule_visit(resident_id: str, payload: VisitCreate, db: AsyncSession = Depends(get_db)):
    res_r = await db.execute(select(Resident).where(Resident.id == resident_id))
    if not res_r.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Resident not found")

    visit = Visit(
        id=str(uuid.uuid4()),
        residentId=resident_id,
        visitorName=payload.visitorName,
        visitorPhone=payload.visitorPhone,
        relationship=payload.relationship,
        checkInTime=datetime.utcnow(),
        purpose=payload.purpose,
        notes=payload.notes,
        createdAt=datetime.utcnow(),
        updatedAt=datetime.utcnow(),
    )
    db.add(visit)
    await db.commit()
    await db.refresh(visit)
    return VisitOut.model_validate(visit)
