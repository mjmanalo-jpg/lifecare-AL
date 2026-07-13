import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func, or_
from app.db import get_db
from app.auth import get_current_user
from app.models.portal import Message, User, Notification
from app.schemas.portal import MessageCreate, MessageOut, UnreadCount, NotificationOut
from app.realtime import manager

router = APIRouter()


def _msg_to_out(msg: Message, sender: User | None = None, recipient: User | None = None) -> dict:
    return {
        "id": msg.id,
        "senderId": msg.senderId,
        "senderName": f"{sender.firstName or ''} {sender.lastName or ''}".strip() or sender.name if sender else None,
        "recipientId": msg.recipientId,
        "recipientName": f"{recipient.firstName or ''} {recipient.lastName or ''}".strip() or recipient.name if recipient else None,
        "subject": msg.subject,
        "content": msg.content,
        "messageType": msg.messageType,
        "isRead": msg.isRead,
        "readAt": msg.readAt.isoformat() if msg.readAt else None,
        "createdAt": msg.createdAt.isoformat(),
    }


@router.get("/{user_id}", response_model=list[MessageOut])
async def get_inbox(
    user_id: str,
    folder: str = Query("inbox", pattern="^(inbox|sent|all)$"),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    if folder == "inbox":
        query = select(Message).where(Message.recipientId == user_id)
    elif folder == "sent":
        query = select(Message).where(Message.senderId == user_id)
    else:
        query = select(Message).where(
            or_(Message.recipientId == user_id, Message.senderId == user_id)
        )

    query = query.order_by(desc(Message.createdAt)).limit(limit)
    result = await db.execute(query)
    messages = result.scalars().all()

    out = []
    for msg in messages:
        sender_r = await db.execute(select(User).where(User.id == msg.senderId))
        recipient_r = await db.execute(select(User).where(User.id == msg.recipientId))
        out.append(MessageOut(**_msg_to_out(msg, sender_r.scalar_one_or_none(), recipient_r.scalar_one_or_none())))
    return out


@router.post("", response_model=MessageOut)
async def send_message(payload: MessageCreate, db: AsyncSession = Depends(get_db)):
    sender_r = await db.execute(select(User).where(User.id == payload.senderId))
    if not sender_r.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Sender not found")

    recipient_r = await db.execute(select(User).where(User.id == payload.recipientId))
    if not recipient_r.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Recipient not found")

    msg = Message(
        id=str(uuid.uuid4()),
        senderId=payload.senderId,
        recipientId=payload.recipientId,
        subject=payload.subject,
        content=payload.content,
        messageType=payload.messageType,
        isRead=False,
        createdAt=datetime.utcnow(),
        updatedAt=datetime.utcnow(),
    )
    db.add(msg)
    await db.flush()

    notif = Notification(
        id=str(uuid.uuid4()),
        userId=payload.recipientId,
        type="MESSAGE",
        title=payload.subject or "New Message",
        message=payload.content[:200],
        relatedEntityId=msg.id,
        relatedEntityType="Message",
        isRead=False,
        createdAt=datetime.utcnow(),
        updatedAt=datetime.utcnow(),
    )
    db.add(notif)

    data = _msg_to_out(msg, sender_r.scalar_one_or_none(), recipient_r.scalar_one_or_none())
    await manager.send_to_user(payload.recipientId, {"type": "NEW_MESSAGE", "data": data})

    await db.commit()
    return MessageOut(**data)


@router.put("/{message_id}/read", response_model=MessageOut)
async def mark_as_read(message_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Message).where(Message.id == message_id))
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    msg.isRead = True
    msg.readAt = datetime.utcnow()
    msg.updatedAt = datetime.utcnow()
    await db.flush()

    sender_r = await db.execute(select(User).where(User.id == msg.senderId))
    recipient_r = await db.execute(select(User).where(User.id == msg.recipientId))
    data = _msg_to_out(msg, sender_r.scalar_one_or_none(), recipient_r.scalar_one_or_none())
    await db.commit()
    return MessageOut(**data)


@router.get("/unread/{user_id}", response_model=UnreadCount)
async def get_unread_count(user_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(func.count(Message.id))
        .where(Message.recipientId == user_id, Message.isRead == False)
    )
    count = result.scalar() or 0
    return UnreadCount(userId=user_id, unread=count)


@router.get("/notifications/{user_id}", response_model=list[NotificationOut])
async def get_notifications(
    user_id: str,
    unread_only: bool = Query(False),
    limit: int = Query(30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    query = select(Notification).where(Notification.userId == user_id)
    if unread_only:
        query = query.where(Notification.isRead == False)
    query = query.order_by(desc(Notification.createdAt)).limit(limit)
    result = await db.execute(query)
    return [NotificationOut.model_validate(n) for n in result.scalars().all()]


@router.websocket("/ws/{user_id}")
async def messages_ws(websocket: WebSocket, user_id: str):
    from app.realtime import manager as mgr
    await mgr.connect(websocket, f"messages:{user_id}", user_id)
    try:
        while True:
            await websocket.receive_text()
    except Exception:
        mgr.disconnect(websocket, f"messages:{user_id}", user_id)
