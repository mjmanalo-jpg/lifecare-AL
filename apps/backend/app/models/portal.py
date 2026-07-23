import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, Float, Integer, Boolean, DateTime,
    ForeignKey, Index, func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _uuid() -> str:
    return str(uuid.uuid4())


# ── User ─────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "User"

    id: Mapped[str] = mapped_column("id", String(36), primary_key=True, default=_uuid)
    authUserId: Mapped[str | None] = mapped_column("authUserId", String(36), unique=True)
    platformRole: Mapped[str | None] = mapped_column("platformRole", String(30))
    role: Mapped[str] = mapped_column("role", String(25), default="FAMILY")
    email: Mapped[str] = mapped_column("email", String(255), unique=True, nullable=False)
    name: Mapped[str] = mapped_column("name", String(255), nullable=False)
    firstName: Mapped[str | None] = mapped_column("firstName", String(100))
    lastName: Mapped[str | None] = mapped_column("lastName", String(100))
    phone: Mapped[str | None] = mapped_column("phone", String(30))
    isActive: Mapped[bool] = mapped_column("isActive", Boolean, default=True)
    lastLogin: Mapped[datetime | None] = mapped_column("lastLogin", DateTime)
    createdAt: Mapped[datetime] = mapped_column("createdAt", DateTime, server_default=func.now())
    updatedAt: Mapped[datetime] = mapped_column("updatedAt", DateTime, server_default=func.now(), onupdate=func.now())

    staff = relationship("Staff", back_populates="user", uselist=False, lazy="selectin")
    sent_messages = relationship("Message", foreign_keys="Message.senderId", lazy="selectin")
    received_messages = relationship("Message", foreign_keys="Message.recipientId", lazy="selectin")
    notifications = relationship("Notification", lazy="selectin")


# ── Resident ─────────────────────────────────────────────────────────────────

class Resident(Base):
    __tablename__ = "Resident"

    id: Mapped[str] = mapped_column("id", String(36), primary_key=True, default=_uuid)
    organizationId: Mapped[str | None] = mapped_column("organizationId", String(36), index=True)
    communityId: Mapped[str | None] = mapped_column("communityId", String(36), index=True)
    firstName: Mapped[str] = mapped_column("firstName", String(100), nullable=False)
    lastName: Mapped[str] = mapped_column("lastName", String(100), nullable=False)
    dateOfBirth: Mapped[datetime | None] = mapped_column("dateOfBirth", DateTime)
    gender: Mapped[str | None] = mapped_column("gender", String(20))
    phone: Mapped[str | None] = mapped_column("phone", String(30))
    email: Mapped[str | None] = mapped_column("email", String(255))
    roomNumber: Mapped[str] = mapped_column("roomNumber", String(20), nullable=False)
    careLevel: Mapped[str] = mapped_column("careLevel", String(20), nullable=False)
    admissionDate: Mapped[datetime] = mapped_column("admissionDate", DateTime, nullable=False)
    emergencyContact: Mapped[str | None] = mapped_column("emergencyContact", String(255))
    emergencyContactPhone: Mapped[str | None] = mapped_column("emergencyContactPhone", String(30))
    medicalHistory: Mapped[str | None] = mapped_column("medicalHistory", Text)
    allergies: Mapped[str | None] = mapped_column("allergies", Text)
    notes: Mapped[str | None] = mapped_column("notes", Text)
    sponsorId: Mapped[str | None] = mapped_column("sponsorId", String(36), ForeignKey("User.id"))
    userId: Mapped[str | None] = mapped_column("userId", String(36), ForeignKey("User.id"), unique=True)
    createdAt: Mapped[datetime] = mapped_column("createdAt", DateTime, server_default=func.now())
    updatedAt: Mapped[datetime] = mapped_column("updatedAt", DateTime, server_default=func.now(), onupdate=func.now())

    vitals = relationship("VitalsLog", back_populates="resident", lazy="selectin")
    medications = relationship("Medication", back_populates="resident", lazy="selectin")
    tasks = relationship("Task", back_populates="resident", lazy="selectin")
    call_bells = relationship("CallBell", back_populates="resident", lazy="selectin")
    visits = relationship("Visit", back_populates="resident", lazy="selectin")
    transport_requests = relationship("TransportRequest", back_populates="resident", lazy="selectin")

    __table_args__ = (
        Index("idx_resident_careLevel", "careLevel"),
        Index("idx_resident_roomNumber", "roomNumber"),
        Index("idx_resident_sponsorId", "sponsorId"),
    )


# ── Staff ────────────────────────────────────────────────────────────────────

class Staff(Base):
    __tablename__ = "Staff"

    id: Mapped[str] = mapped_column("id", String(36), primary_key=True, default=_uuid)
    organizationId: Mapped[str | None] = mapped_column("organizationId", String(36), index=True)
    communityId: Mapped[str | None] = mapped_column("communityId", String(36), index=True)
    userId: Mapped[str] = mapped_column("userId", String(36), ForeignKey("User.id"), unique=True)
    position: Mapped[str] = mapped_column("position", String(100), nullable=False)
    department: Mapped[str | None] = mapped_column("department", String(100))
    hireDate: Mapped[datetime] = mapped_column("hireDate", DateTime, nullable=False)
    license: Mapped[str | None] = mapped_column("license", String(100))
    isActive: Mapped[bool] = mapped_column("isActive", Boolean, default=True)
    isApproved: Mapped[bool] = mapped_column("isApproved", Boolean, default=False)
    avatarUrl: Mapped[str | None] = mapped_column("avatarUrl", String(500))

    user = relationship("User", back_populates="staff", lazy="selectin")


# ── VitalsLog ────────────────────────────────────────────────────────────────

class VitalsLog(Base):
    __tablename__ = "VitalsLog"

    id: Mapped[str] = mapped_column("id", String(36), primary_key=True, default=_uuid)
    organizationId: Mapped[str | None] = mapped_column("organizationId", String(36), index=True)
    communityId: Mapped[str | None] = mapped_column("communityId", String(36), index=True)
    residentId: Mapped[str] = mapped_column("residentId", String(36), ForeignKey("Resident.id"), nullable=False)
    type: Mapped[str] = mapped_column("type", String(30), nullable=False)
    value: Mapped[str] = mapped_column("value", String(100), nullable=False)
    unit: Mapped[str | None] = mapped_column("unit", String(20))
    recordedAt: Mapped[datetime] = mapped_column("recordedAt", DateTime, nullable=False)
    recordedBy: Mapped[str | None] = mapped_column("recordedBy", String(255))
    notes: Mapped[str | None] = mapped_column("notes", Text)
    createdAt: Mapped[datetime] = mapped_column("createdAt", DateTime, server_default=func.now())
    updatedAt: Mapped[datetime] = mapped_column("updatedAt", DateTime, server_default=func.now(), onupdate=func.now())

    resident = relationship("Resident", back_populates="vitals", lazy="selectin")

    __table_args__ = (
        Index("idx_vitalslog_residentId", "residentId"),
        Index("idx_vitalslog_recordedAt", "recordedAt"),
        Index("idx_vitalslog_type", "type"),
        Index("idx_vitalslog_compound", "residentId", "type", "recordedAt"),
    )


# ── Medication ───────────────────────────────────────────────────────────────

class Medication(Base):
    __tablename__ = "Medication"

    id: Mapped[str] = mapped_column("id", String(36), primary_key=True, default=_uuid)
    organizationId: Mapped[str | None] = mapped_column("organizationId", String(36), index=True)
    communityId: Mapped[str | None] = mapped_column("communityId", String(36), index=True)
    residentId: Mapped[str] = mapped_column("residentId", String(36), ForeignKey("Resident.id"), nullable=False)
    name: Mapped[str] = mapped_column("name", String(255), nullable=False)
    dosage: Mapped[str] = mapped_column("dosage", String(100), nullable=False)
    frequency: Mapped[str] = mapped_column("frequency", String(100), nullable=False)
    route: Mapped[str] = mapped_column("route", String(50), default="oral")
    status: Mapped[str] = mapped_column("status", String(20), default="ACTIVE")
    startDate: Mapped[datetime] = mapped_column("startDate", DateTime, nullable=False)
    endDate: Mapped[datetime | None] = mapped_column("endDate", DateTime)
    prescribedBy: Mapped[str | None] = mapped_column("prescribedBy", String(255))
    reason: Mapped[str | None] = mapped_column("reason", Text)
    sideEffects: Mapped[str | None] = mapped_column("sideEffects", Text)
    contraindications: Mapped[str | None] = mapped_column("contraindications", Text)
    createdAt: Mapped[datetime] = mapped_column("createdAt", DateTime, server_default=func.now())
    updatedAt: Mapped[datetime] = mapped_column("updatedAt", DateTime, server_default=func.now(), onupdate=func.now())

    resident = relationship("Resident", back_populates="medications", lazy="selectin")

    __table_args__ = (
        Index("idx_medication_residentId", "residentId"),
        Index("idx_medication_status", "status"),
    )


# ── CallBell ─────────────────────────────────────────────────────────────────

class CallBell(Base):
    __tablename__ = "CallBell"

    id: Mapped[str] = mapped_column("id", String(36), primary_key=True, default=_uuid)
    organizationId: Mapped[str | None] = mapped_column("organizationId", String(36), index=True)
    communityId: Mapped[str | None] = mapped_column("communityId", String(36), index=True)
    residentId: Mapped[str] = mapped_column("residentId", String(36), ForeignKey("Resident.id"), nullable=False)
    status: Mapped[str] = mapped_column("status", String(20), default="PENDING")
    reason: Mapped[str | None] = mapped_column("reason", Text)
    respondedAt: Mapped[datetime | None] = mapped_column("respondedAt", DateTime)
    resolvedAt: Mapped[datetime | None] = mapped_column("resolvedAt", DateTime)
    notes: Mapped[str | None] = mapped_column("notes", Text)
    createdAt: Mapped[datetime] = mapped_column("createdAt", DateTime, server_default=func.now())
    updatedAt: Mapped[datetime] = mapped_column("updatedAt", DateTime, server_default=func.now(), onupdate=func.now())

    resident = relationship("Resident", back_populates="call_bells", lazy="selectin")

    __table_args__ = (
        Index("idx_callbell_residentId", "residentId"),
        Index("idx_callbell_status", "status"),
        Index("idx_callbell_createdAt", "createdAt"),
    )


# ── Task (Daily Goals / Schedule) ────────────────────────────────────────────

class Task(Base):
    __tablename__ = "Task"

    id: Mapped[str] = mapped_column("id", String(36), primary_key=True, default=_uuid)
    organizationId: Mapped[str | None] = mapped_column("organizationId", String(36), index=True)
    communityId: Mapped[str | None] = mapped_column("communityId", String(36), index=True)
    residentId: Mapped[str] = mapped_column("residentId", String(36), ForeignKey("Resident.id"), nullable=False)
    title: Mapped[str] = mapped_column("title", String(255), nullable=False)
    description: Mapped[str | None] = mapped_column("description", Text)
    status: Mapped[str] = mapped_column("status", String(20), default="PENDING")
    priority: Mapped[str] = mapped_column("priority", String(20), default="MEDIUM")
    assignedToId: Mapped[str | None] = mapped_column("assignedToId", String(36), ForeignKey("Staff.id"))
    dueDate: Mapped[datetime] = mapped_column("dueDate", DateTime, nullable=False)
    completedAt: Mapped[datetime | None] = mapped_column("completedAt", DateTime)
    createdAt: Mapped[datetime] = mapped_column("createdAt", DateTime, server_default=func.now())
    updatedAt: Mapped[datetime] = mapped_column("updatedAt", DateTime, server_default=func.now(), onupdate=func.now())

    resident = relationship("Resident", back_populates="tasks", lazy="selectin")

    __table_args__ = (
        Index("idx_task_residentId", "residentId"),
        Index("idx_task_status", "status"),
        Index("idx_task_dueDate", "dueDate"),
    )


# ── Message ──────────────────────────────────────────────────────────────────

class Message(Base):
    __tablename__ = "Message"

    id: Mapped[str] = mapped_column("id", String(36), primary_key=True, default=_uuid)
    organizationId: Mapped[str | None] = mapped_column("organizationId", String(36), index=True)
    communityId: Mapped[str | None] = mapped_column("communityId", String(36), index=True)
    senderId: Mapped[str] = mapped_column("senderId", String(36), ForeignKey("User.id"), nullable=False)
    recipientId: Mapped[str] = mapped_column("recipientId", String(36), ForeignKey("User.id"), nullable=False)
    subject: Mapped[str | None] = mapped_column("subject", String(255))
    content: Mapped[str] = mapped_column("content", Text, nullable=False)
    messageType: Mapped[str] = mapped_column("messageType", String(20), default="GENERAL")
    isRead: Mapped[bool] = mapped_column("isRead", Boolean, default=False)
    readAt: Mapped[datetime | None] = mapped_column("readAt", DateTime)
    createdAt: Mapped[datetime] = mapped_column("createdAt", DateTime, server_default=func.now())
    updatedAt: Mapped[datetime] = mapped_column("updatedAt", DateTime, server_default=func.now(), onupdate=func.now())

    sender = relationship("User", foreign_keys=[senderId], lazy="selectin")
    recipient = relationship("User", foreign_keys=[recipientId], lazy="selectin")

    __table_args__ = (
        Index("idx_message_senderId", "senderId"),
        Index("idx_message_recipientId", "recipientId"),
        Index("idx_message_isRead", "isRead"),
        Index("idx_message_createdAt", "createdAt"),
    )


# ── Notification ─────────────────────────────────────────────────────────────

class Notification(Base):
    __tablename__ = "Notification"

    id: Mapped[str] = mapped_column("id", String(36), primary_key=True, default=_uuid)
    organizationId: Mapped[str | None] = mapped_column("organizationId", String(36), index=True)
    communityId: Mapped[str | None] = mapped_column("communityId", String(36), index=True)
    userId: Mapped[str] = mapped_column("userId", String(36), ForeignKey("User.id"), nullable=False)
    type: Mapped[str] = mapped_column("type", String(30), nullable=False)
    title: Mapped[str] = mapped_column("title", String(255), nullable=False)
    message: Mapped[str] = mapped_column("message", Text, nullable=False)
    relatedEntityId: Mapped[str | None] = mapped_column("relatedEntityId", String(36))
    relatedEntityType: Mapped[str | None] = mapped_column("relatedEntityType", String(50))
    isRead: Mapped[bool] = mapped_column("isRead", Boolean, default=False)
    readAt: Mapped[datetime | None] = mapped_column("readAt", DateTime)
    createdAt: Mapped[datetime] = mapped_column("createdAt", DateTime, server_default=func.now())
    updatedAt: Mapped[datetime] = mapped_column("updatedAt", DateTime, server_default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="notifications", lazy="selectin")


# ── Room ─────────────────────────────────────────────────────────────────────

class Room(Base):
    __tablename__ = "Room"

    id: Mapped[str] = mapped_column("id", String(36), primary_key=True, default=_uuid)
    organizationId: Mapped[str | None] = mapped_column("organizationId", String(36), index=True)
    communityId: Mapped[str | None] = mapped_column("communityId", String(36), index=True)
    roomNumber: Mapped[str] = mapped_column("roomNumber", String(20), nullable=False)
    floor: Mapped[int | None] = mapped_column("floor", Integer)
    wing: Mapped[str | None] = mapped_column("wing", String(50))
    roomType: Mapped[str] = mapped_column("roomType", String(20), default="SEMI_PRIVATE")
    capacity: Mapped[int] = mapped_column("capacity", Integer, default=1)
    status: Mapped[str] = mapped_column("status", String(20), default="AVAILABLE")
    features: Mapped[str | None] = mapped_column("features", Text)
    rateMonthly: Mapped[float | None] = mapped_column("rateMonthly", Float)
    notes: Mapped[str | None] = mapped_column("notes", Text)
    createdAt: Mapped[datetime] = mapped_column("createdAt", DateTime, server_default=func.now())
    updatedAt: Mapped[datetime] = mapped_column("updatedAt", DateTime, server_default=func.now(), onupdate=func.now())


# ── Visit ────────────────────────────────────────────────────────────────────

class Visit(Base):
    __tablename__ = "Visit"

    id: Mapped[str] = mapped_column("id", String(36), primary_key=True, default=_uuid)
    organizationId: Mapped[str | None] = mapped_column("organizationId", String(36), index=True)
    communityId: Mapped[str | None] = mapped_column("communityId", String(36), index=True)
    residentId: Mapped[str] = mapped_column("residentId", String(36), ForeignKey("Resident.id"), nullable=False)
    visitorName: Mapped[str] = mapped_column("visitorName", String(255), nullable=False)
    visitorPhone: Mapped[str | None] = mapped_column("visitorPhone", String(30))
    visitorRelationship: Mapped[str | None] = mapped_column("relationship", String(100))
    checkInTime: Mapped[datetime] = mapped_column("checkInTime", DateTime, nullable=False)
    checkOutTime: Mapped[datetime | None] = mapped_column("checkOutTime", DateTime)
    purpose: Mapped[str | None] = mapped_column("purpose", Text)
    notes: Mapped[str | None] = mapped_column("notes", Text)
    createdAt: Mapped[datetime] = mapped_column("createdAt", DateTime, server_default=func.now())
    updatedAt: Mapped[datetime] = mapped_column("updatedAt", DateTime, server_default=func.now(), onupdate=func.now())

    resident = relationship("Resident", back_populates="visits", lazy="selectin")


# ── TransportRequest (Appointments) ──────────────────────────────────────────

class TransportRequest(Base):
    __tablename__ = "TransportRequest"

    id: Mapped[str] = mapped_column("id", String(36), primary_key=True, default=_uuid)
    organizationId: Mapped[str | None] = mapped_column("organizationId", String(36), index=True)
    communityId: Mapped[str | None] = mapped_column("communityId", String(36), index=True)
    residentId: Mapped[str] = mapped_column("residentId", String(36), ForeignKey("Resident.id"), nullable=False)
    type: Mapped[str] = mapped_column("type", String(30), default="MEDICAL_APPOINTMENT")
    destination: Mapped[str] = mapped_column("destination", String(255), nullable=False)
    purpose: Mapped[str | None] = mapped_column("purpose", Text)
    requestedDate: Mapped[datetime] = mapped_column("requestedDate", DateTime, nullable=False)
    returnRequired: Mapped[bool] = mapped_column("returnRequired", Boolean, default=True)
    wheelchairNeeded: Mapped[bool] = mapped_column("wheelchairNeeded", Boolean, default=False)
    escortRequired: Mapped[bool] = mapped_column("escortRequired", Boolean, default=False)
    escortRole: Mapped[str | None] = mapped_column("escortRole", String(20))
    priority: Mapped[str] = mapped_column("priority", String(20), default="NORMAL")
    status: Mapped[str] = mapped_column("status", String(20), default="PENDING")
    source: Mapped[str] = mapped_column("source", String(20), default="PORTAL")
    notes: Mapped[str | None] = mapped_column("notes", Text)
    reviewedBy: Mapped[str | None] = mapped_column("reviewedBy", String(36))
    reviewedAt: Mapped[datetime | None] = mapped_column("reviewedAt", DateTime)
    declineReason: Mapped[str | None] = mapped_column("declineReason", Text)
    createdAt: Mapped[datetime] = mapped_column("createdAt", DateTime, server_default=func.now())
    updatedAt: Mapped[datetime] = mapped_column("updatedAt", DateTime, server_default=func.now(), onupdate=func.now())

    resident = relationship("Resident", back_populates="transport_requests", lazy="selectin")

    __table_args__ = (
        Index("idx_transport_residentId", "residentId"),
        Index("idx_transport_status", "status"),
        Index("idx_transport_requestedDate", "requestedDate"),
    )


# ── KnowledgeDoc (AI Companion knowledge base) ───────────────────────────────

class KnowledgeDoc(Base):
    __tablename__ = "KnowledgeDoc"

    id: Mapped[str] = mapped_column("id", String(36), primary_key=True, default=_uuid)
    organizationId: Mapped[str | None] = mapped_column("organizationId", String(36), index=True)
    communityId: Mapped[str | None] = mapped_column("communityId", String(36), index=True)
    name: Mapped[str] = mapped_column("name", String(255), nullable=False)
    type: Mapped[str] = mapped_column("type", String(50), default="unknown")
    size: Mapped[int] = mapped_column("size", Integer, default=0)
    chars: Mapped[int] = mapped_column("chars", Integer, default=0)
    text: Mapped[str] = mapped_column("text", Text, nullable=False)
    source: Mapped[str] = mapped_column("source", String(50), default="client")
    createdAt: Mapped[datetime] = mapped_column("createdAt", DateTime, server_default=func.now())


# ── ServiceCharge ────────────────────────────────────────────────────────────

class ServiceCharge(Base):
    __tablename__ = "ServiceCharge"

    id: Mapped[str] = mapped_column("id", String(36), primary_key=True, default=_uuid)
    organizationId: Mapped[str | None] = mapped_column("organizationId", String(36), index=True)
    communityId: Mapped[str | None] = mapped_column("communityId", String(36), index=True)
    residentId: Mapped[str] = mapped_column("residentId", String(36), ForeignKey("Resident.id"), nullable=False)
    description: Mapped[str] = mapped_column("description", String(255), nullable=False)
    amount: Mapped[float] = mapped_column("amount", Float, nullable=False)
    serviceDate: Mapped[datetime] = mapped_column("serviceDate", DateTime, nullable=False)
    category: Mapped[str] = mapped_column("category", String(100), default="Care Services")
    invoiceId: Mapped[str | None] = mapped_column("invoiceId", String(36))
    createdAt: Mapped[datetime] = mapped_column("createdAt", DateTime, server_default=func.now())
    updatedAt: Mapped[datetime] = mapped_column("updatedAt", DateTime, server_default=func.now(), onupdate=func.now())

    resident = relationship("Resident", lazy="selectin")


# ── AiChatMessage (backend-only, AI Companion history) ───────────────────────

class AiChatMessage(Base):
    __tablename__ = "AiChatMessage"

    id: Mapped[str] = mapped_column("id", String(36), primary_key=True, default=_uuid)
    organizationId: Mapped[str | None] = mapped_column("organizationId", String(36), index=True)
    communityId: Mapped[str | None] = mapped_column("communityId", String(36), index=True)
    residentId: Mapped[str] = mapped_column("residentId", String(36), ForeignKey("Resident.id"), nullable=False)
    role: Mapped[str] = mapped_column("role", String(20), nullable=False)
    content: Mapped[str] = mapped_column("content", Text, nullable=False)
    language: Mapped[str] = mapped_column("language", String(10), default="en")
    intent: Mapped[str | None] = mapped_column("intent", String(50))
    meta: Mapped[str | None] = mapped_column("metadata", Text)
    createdAt: Mapped[datetime] = mapped_column("createdAt", DateTime, server_default=func.now())

    resident = relationship("Resident", lazy="selectin")

    __table_args__ = (
        Index("idx_aichat_residentId", "residentId"),
        Index("idx_aichat_createdAt", "createdAt"),
    )
