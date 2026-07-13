import uuid
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, and_, func
from app.db import get_db
from app.auth import get_current_user
from app.models.portal import Task, Resident
from app.schemas.portal import TaskCreate, TaskUpdate, TaskOut, DailySchedule

router = APIRouter()


@router.get("/{resident_id}/today", response_model=DailySchedule)
async def get_today_schedule(resident_id: str, db: AsyncSession = Depends(get_db)):
    now = datetime.utcnow()
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)

    result = await db.execute(
        select(Task)
        .where(
            Task.residentId == resident_id,
            Task.dueDate >= start_of_day,
            Task.dueDate < end_of_day,
        )
        .order_by(Task.dueDate)
    )
    tasks = [TaskOut.model_validate(t) for t in result.scalars().all()]
    completed = sum(1 for t in tasks if t.status == "COMPLETED")
    return DailySchedule(
        date=start_of_day.strftime("%Y-%m-%d"),
        tasks=tasks,
        total=len(tasks),
        completed=completed,
        pending=len(tasks) - completed,
    )


@router.get("/{resident_id}/week", response_model=list[DailySchedule])
async def get_week_schedule(resident_id: str, db: AsyncSession = Depends(get_db)):
    now = datetime.utcnow()
    start_of_week = now - timedelta(days=now.weekday())
    start_of_week = start_of_week.replace(hour=0, minute=0, second=0, microsecond=0)

    schedules = []
    for i in range(7):
        day_start = start_of_week + timedelta(days=i)
        day_end = day_start + timedelta(days=1)

        result = await db.execute(
            select(Task)
            .where(
                Task.residentId == resident_id,
                Task.dueDate >= day_start,
                Task.dueDate < day_end,
            )
            .order_by(Task.dueDate)
        )
        tasks = [TaskOut.model_validate(t) for t in result.scalars().all()]
        completed = sum(1 for t in tasks if t.status == "COMPLETED")
        schedules.append(DailySchedule(
            date=day_start.strftime("%Y-%m-%d"),
            tasks=tasks,
            total=len(tasks),
            completed=completed,
            pending=len(tasks) - completed,
        ))
    return schedules


@router.get("/{resident_id}", response_model=list[TaskOut])
async def get_all_tasks(
    resident_id: str,
    status: str = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    query = select(Task).where(Task.residentId == resident_id)
    if status:
        query = query.where(Task.status == status)
    query = query.order_by(desc(Task.dueDate)).limit(limit)
    result = await db.execute(query)
    return [TaskOut.model_validate(t) for t in result.scalars().all()]


@router.post("", response_model=TaskOut)
async def create_task(payload: TaskCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Resident).where(Resident.id == payload.residentId))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Resident not found")

    task = Task(
        id=str(uuid.uuid4()),
        residentId=payload.residentId,
        title=payload.title,
        description=payload.description,
        status="PENDING",
        priority=payload.priority,
        dueDate=payload.dueDate,
        createdAt=datetime.utcnow(),
        updatedAt=datetime.utcnow(),
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return TaskOut.model_validate(task)


@router.put("/{task_id}", response_model=TaskOut)
async def update_task(task_id: str, payload: TaskUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(task, key, value)
    task.updatedAt = datetime.utcnow()

    await db.commit()
    await db.refresh(task)
    return TaskOut.model_validate(task)


@router.put("/{task_id}/status", response_model=TaskOut)
async def update_task_status(task_id: str, status: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    valid = {"PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"}
    if status not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid}")

    task.status = status
    if status == "COMPLETED":
        task.completedAt = datetime.utcnow()
    task.updatedAt = datetime.utcnow()

    await db.commit()
    await db.refresh(task)
    return TaskOut.model_validate(task)


@router.delete("/{task_id}")
async def delete_task(task_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await db.delete(task)
    await db.commit()
    return {"status": "deleted", "id": task_id}
