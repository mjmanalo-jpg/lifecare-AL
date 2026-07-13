from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime


# ── AI Companion ─────────────────────────────────────────────────────────────

class AiChatRequest(BaseModel):
    residentId: str
    message: str
    language: str = "en"

class AiVoiceRequest(BaseModel):
    residentId: str
    audio_base64: str
    language: str = "en"

class AiChatResponse(BaseModel):
    reply: str
    intent: Optional[str] = None
    language: str = "en"
    actions: List[dict] = []
    deepLink: Optional[str] = None

class AiChatHistory(BaseModel):
    id: str
    role: str
    content: str
    language: str
    intent: Optional[str] = None
    createdAt: datetime


# ── Call Bell & SOS ──────────────────────────────────────────────────────────

class CallBellCreate(BaseModel):
    residentId: str
    reason: Optional[str] = None

class CallBellSOS(BaseModel):
    residentId: str
    reason: str = "EMERGENCY - SOS triggered"

class CallBellRespond(BaseModel):
    notes: Optional[str] = None

class CallBellResolve(BaseModel):
    notes: Optional[str] = None

class CallBellOut(BaseModel):
    id: str
    residentId: str
    residentName: Optional[str] = None
    roomNumber: Optional[str] = None
    status: str
    reason: Optional[str] = None
    respondedAt: Optional[datetime] = None
    resolvedAt: Optional[datetime] = None
    notes: Optional[str] = None
    createdAt: datetime

    class Config:
        from_attributes = True


# ── Vitals ───────────────────────────────────────────────────────────────────

class VitalsCreate(BaseModel):
    residentId: str
    type: Literal["BLOOD_PRESSURE", "HEART_RATE", "TEMPERATURE", "OXYGEN", "BLOOD_GLUCOSE", "WEIGHT", "RESPIRATORY_RATE"]
    value: str
    unit: Optional[str] = None
    recordedBy: Optional[str] = None
    notes: Optional[str] = None
    recordedAt: Optional[datetime] = None

class VitalsOut(BaseModel):
    id: str
    residentId: str
    type: str
    value: str
    unit: Optional[str] = None
    recordedAt: datetime
    recordedBy: Optional[str] = None
    notes: Optional[str] = None
    createdAt: datetime

    class Config:
        from_attributes = True

class VitalsTrend(BaseModel):
    type: str
    readings: List[VitalsOut]


# ── Medications ──────────────────────────────────────────────────────────────

class MedicationCreate(BaseModel):
    residentId: str
    name: str
    dosage: str
    frequency: str
    route: str = "oral"
    status: str = "ACTIVE"
    startDate: datetime
    endDate: Optional[datetime] = None
    prescribedBy: Optional[str] = None
    reason: Optional[str] = None
    sideEffects: Optional[str] = None
    contraindications: Optional[str] = None

class MedicationUpdate(BaseModel):
    name: Optional[str] = None
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    route: Optional[str] = None
    status: Optional[str] = None
    endDate: Optional[datetime] = None
    reason: Optional[str] = None
    sideEffects: Optional[str] = None

class MedicationOut(BaseModel):
    id: str
    residentId: str
    name: str
    dosage: str
    frequency: str
    route: str
    status: str
    startDate: datetime
    endDate: Optional[datetime] = None
    prescribedBy: Optional[str] = None
    reason: Optional[str] = None
    sideEffects: Optional[str] = None
    contraindications: Optional[str] = None
    createdAt: datetime

    class Config:
        from_attributes = True


# ── Schedule / Tasks ─────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    residentId: str
    title: str
    description: Optional[str] = None
    priority: str = "MEDIUM"
    dueDate: datetime

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    dueDate: Optional[datetime] = None

class TaskOut(BaseModel):
    id: str
    residentId: str
    title: str
    description: Optional[str] = None
    status: str
    priority: str
    assignedToId: Optional[str] = None
    dueDate: datetime
    completedAt: Optional[datetime] = None
    createdAt: datetime

    class Config:
        from_attributes = True

class DailySchedule(BaseModel):
    date: str
    tasks: List[TaskOut]
    total: int
    completed: int
    pending: int


# ── Messages ─────────────────────────────────────────────────────────────────

class MessageCreate(BaseModel):
    senderId: str
    recipientId: str
    subject: Optional[str] = None
    content: str
    messageType: str = "GENERAL"

class MessageOut(BaseModel):
    id: str
    senderId: str
    senderName: Optional[str] = None
    recipientId: str
    recipientName: Optional[str] = None
    subject: Optional[str] = None
    content: str
    messageType: str
    isRead: bool
    readAt: Optional[datetime] = None
    createdAt: datetime

    class Config:
        from_attributes = True

class UnreadCount(BaseModel):
    userId: str
    unread: int


# ── Appointments (Transport Requests) ────────────────────────────────────────

class AppointmentCreate(BaseModel):
    residentId: str
    type: str = "MEDICAL_APPOINTMENT"
    destination: str
    purpose: Optional[str] = None
    requestedDate: datetime
    returnRequired: bool = True
    wheelchairNeeded: bool = False
    escortRequired: bool = False
    escortRole: Optional[str] = None
    priority: str = "NORMAL"
    notes: Optional[str] = None

class AppointmentOut(BaseModel):
    id: str
    residentId: str
    type: str
    destination: str
    purpose: Optional[str] = None
    requestedDate: datetime
    returnRequired: bool
    priority: str
    status: str
    source: str
    notes: Optional[str] = None
    declineReason: Optional[str] = None
    createdAt: datetime

    class Config:
        from_attributes = True


# ── Room & Hotel Services ────────────────────────────────────────────────────

class RoomServiceRequest(BaseModel):
    residentId: str
    serviceType: str
    description: Optional[str] = None
    scheduledTime: Optional[datetime] = None

class RoomServiceOut(BaseModel):
    id: str
    residentId: str
    description: str
    amount: float
    serviceDate: datetime
    category: str
    createdAt: datetime

    class Config:
        from_attributes = True

class RoomInfo(BaseModel):
    id: str
    roomNumber: str
    floor: Optional[int] = None
    wing: Optional[str] = None
    roomType: str
    capacity: int
    status: str
    features: Optional[str] = None
    rateMonthly: Optional[float] = None


# ── Family Portal ────────────────────────────────────────────────────────────

class FamilyResidentSummary(BaseModel):
    id: str
    firstName: str
    lastName: str
    roomNumber: str
    careLevel: str
    dateOfBirth: Optional[datetime] = None
    gender: Optional[str] = None
    photoUrl: Optional[str] = None

class FamilyDashboard(BaseModel):
    resident: FamilyResidentSummary
    latestVitals: List[VitalsOut]
    activeMedications: List[MedicationOut]
    todayTasks: List[TaskOut]
    recentCallBells: List[CallBellOut]
    upcomingAppointments: List[AppointmentOut]
    unreadMessages: int

class VisitCreate(BaseModel):
    residentId: str
    visitorName: str
    visitorPhone: Optional[str] = None
    relationship: Optional[str] = None
    purpose: Optional[str] = None
    notes: Optional[str] = None

class VisitOut(BaseModel):
    id: str
    residentId: str
    visitorName: str
    visitorPhone: Optional[str] = None
    relationship: Optional[str] = None
    checkInTime: datetime
    checkOutTime: Optional[datetime] = None
    purpose: Optional[str] = None
    notes: Optional[str] = None
    createdAt: datetime

    class Config:
        from_attributes = True


# ── Notifications ────────────────────────────────────────────────────────────

class NotificationOut(BaseModel):
    id: str
    userId: str
    type: str
    title: str
    message: str
    relatedEntityId: Optional[str] = None
    relatedEntityType: Optional[str] = None
    isRead: bool
    createdAt: datetime

    class Config:
        from_attributes = True
