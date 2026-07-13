import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.db import get_db
from app.auth import get_current_user
from app.models.portal import ServiceCharge, Room, Resident
from app.schemas.portal import RoomServiceRequest, RoomServiceOut, RoomInfo

router = APIRouter()

ROOM_SERVICE_CATALOG = [
    {"type": "room_cleaning", "label": "Room Cleaning", "description": "Full room cleaning and tidying", "category": "Housekeeping"},
    {"type": "linen_change", "label": "Linen Change", "description": "Bed linens and towel replacement", "category": "Housekeeping"},
    {"type": "meal_delivery", "label": "Meal Delivery", "description": "In-room meal service", "category": "Dining"},
    {"type": "special_meal", "label": "Special Diet Meal", "description": "Custom dietary requirements", "category": "Dining"},
    {"type": "beverage", "label": "Beverage Service", "description": "Tea, coffee, juice, water", "category": "Dining"},
    {"type": "laundry", "label": "Laundry Service", "description": "Personal laundry wash and fold", "category": "Housekeeping"},
    {"type": "maintenance", "label": "Maintenance Request", "description": "Room equipment or fixture repair", "category": "Maintenance"},
    {"type": "temperature", "label": "Temperature Adjustment", "description": "AC or heating adjustment", "category": "Maintenance"},
    {"type": "entertainment", "label": "Entertainment Setup", "description": "TV, music, or activity setup", "category": "Amenities"},
    {"type": "transport", "label": "Wheelchair Transport", "description": "In-facility transport assistance", "category": "Transport"},
    {"type": "other", "label": "Other Request", "description": "Custom service request", "category": "Other"},
]


@router.get("/catalog")
async def get_service_catalog():
    return {"catalog": ROOM_SERVICE_CATALOG}


@router.get("/room/{resident_id}", response_model=RoomInfo)
async def get_room_info(resident_id: str, db: AsyncSession = Depends(get_db)):
    res_result = await db.execute(select(Resident).where(Resident.id == resident_id))
    resident = res_result.scalar_one_or_none()
    if not resident:
        raise HTTPException(status_code=404, detail="Resident not found")

    room_result = await db.execute(select(Room).where(Room.roomNumber == resident.roomNumber))
    room = room_result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    return RoomInfo(
        id=room.id,
        roomNumber=room.roomNumber,
        floor=room.floor,
        wing=room.wing,
        roomType=room.roomType,
        capacity=room.capacity,
        status=room.status,
        features=room.features,
        rateMonthly=room.rateMonthly,
    )


@router.post("", response_model=RoomServiceOut)
async def request_room_service(payload: RoomServiceRequest, db: AsyncSession = Depends(get_db)):
    res_result = await db.execute(select(Resident).where(Resident.id == payload.residentId))
    resident = res_result.scalar_one_or_none()
    if not resident:
        raise HTTPException(status_code=404, detail="Resident not found")

    matched = next((s for s in ROOM_SERVICE_CATALOG if s["type"] == payload.serviceType), None)
    description = payload.description or (matched["label"] if matched else payload.serviceType)
    category = matched["category"] if matched else "Other"

    charge = ServiceCharge(
        id=str(uuid.uuid4()),
        residentId=payload.residentId,
        description=description,
        amount=0.0,
        serviceDate=payload.scheduledTime or datetime.utcnow(),
        category=category,
        createdAt=datetime.utcnow(),
        updatedAt=datetime.utcnow(),
    )
    db.add(charge)
    await db.commit()
    await db.refresh(charge)

    return RoomServiceOut(
        id=charge.id,
        residentId=charge.residentId,
        description=charge.description,
        amount=charge.amount,
        serviceDate=charge.serviceDate,
        category=charge.category,
        createdAt=charge.createdAt,
    )


@router.get("/{resident_id}", response_model=list[RoomServiceOut])
async def get_service_history(
    resident_id: str,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ServiceCharge)
        .where(ServiceCharge.residentId == resident_id)
        .order_by(desc(ServiceCharge.serviceDate))
        .limit(limit)
    )
    charges = result.scalars().all()
    return [
        RoomServiceOut(
            id=c.id,
            residentId=c.residentId,
            description=c.description,
            amount=c.amount,
            serviceDate=c.serviceDate,
            category=c.category,
            createdAt=c.createdAt,
        )
        for c in charges
    ]
