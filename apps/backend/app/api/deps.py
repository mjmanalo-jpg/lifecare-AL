from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db import get_db
from app.models.portal import Resident
from app.auth import get_current_user


async def get_resident_or_404(resident_id: str, db: AsyncSession = Depends(get_db)) -> Resident:
    result = await db.execute(select(Resident).where(Resident.id == resident_id))
    resident = result.scalar_one_or_none()
    if not resident:
        raise HTTPException(status_code=404, detail="Resident not found")
    return resident


async def get_resident_by_user(user_id: str, db: AsyncSession = Depends(get_db)) -> Resident:
    result = await db.execute(select(Resident).where(Resident.userId == user_id))
    resident = result.scalar_one_or_none()
    if not resident:
        raise HTTPException(status_code=404, detail="No resident profile linked to this user")
    return resident


def validate_resident_access(user: dict, resident: Resident) -> None:
    if user["role"] in ("RESIDENT",):
        if resident.userId != user["id"]:
            raise HTTPException(status_code=403, detail="Access denied")
    elif user["role"] == "FAMILY":
        if resident.sponsorId != user["id"]:
            raise HTTPException(status_code=403, detail="Access denied")
