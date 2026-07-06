# 🚀 Next.js-Only API Routes - Complete Documentation

## Overview
This document describes all API endpoints for the assisted-living facility management portal. All endpoints are implemented as Next.js API routes with Prisma for database access.

---

## 🗂️ API ROUTES IMPLEMENTED (10 Routes)

### **1. RESIDENTS** - `/api/residents`
Manage resident profiles and information.

**GET** - Fetch all residents
```bash
curl http://localhost:3000/api/residents?careLevel=ASSISTED&limit=10
```

**GET** - Fetch single resident
```bash
curl http://localhost:3000/api/residents?id=<resident-id>
```

**POST** - Create resident
```bash
curl -X POST http://localhost:3000/api/residents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "careLevel": "ASSISTED",
    "roomNumber": "101",
    "sponsorId": "<user-id>"
  }'
```

**PUT** - Update resident
```bash
curl -X PUT http://localhost:3000/api/residents?id=<resident-id> \
  -H "Content-Type: application/json" \
  -d '{"name": "Jane Doe"}'
```

**DELETE** - Delete resident
```bash
curl -X DELETE http://localhost:3000/api/residents?id=<resident-id>
```

---

### **2. INCIDENTS** - `/api/incidents`
Report and track safety incidents.

**GET** - Fetch incidents
```bash
curl http://localhost:3000/api/incidents?residentId=<resident-id>&severity=high
```

**POST** - Create incident
```bash
curl -X POST http://localhost:3000/api/incidents \
  -H "Content-Type: application/json" \
  -d '{
    "residentId": "<resident-id>",
    "type": "Fall",
    "description": "Fell in bathroom",
    "severity": "critical"
  }'
```

**DELETE** - Delete incident
```bash
curl -X DELETE http://localhost:3000/api/incidents?id=<incident-id>
```

---

### **3. MEDICATIONS** - `/api/medications`
Manage medication administration and verification.

**GET** - Fetch medications
```bash
curl http://localhost:3000/api/medications?residentId=<resident-id>&status=pending
```

**POST** - Add medication
```bash
curl -X POST http://localhost:3000/api/medications \
  -H "Content-Type: application/json" \
  -d '{
    "residentId": "<resident-id>",
    "name": "Aspirin",
    "dosage": "500mg",
    "frequency": "twice daily"
  }'
```

**PUT** - Verify medication
```bash
curl -X PUT http://localhost:3000/api/medications \
  -H "Content-Type: application/json" \
  -d '{
    "id": "<medication-id>",
    "status": "verified",
    "verifiedBy": "<staff-id>"
  }'
```

---

### **4. TASKS** - `/api/tasks`
Task management for caregivers and nurses.

**GET** - Fetch tasks
```bash
curl http://localhost:3000/api/tasks?residentId=<resident-id>&status=pending
```

**POST** - Create task
```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "residentId": "<resident-id>",
    "title": "Morning medication",
    "description": "Give morning insulin",
    "dueAt": "2026-07-07T08:00:00Z",
    "assignedTo": "<staff-id>"
  }'
```

**PUT** - Update task
```bash
curl -X PUT http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "id": "<task-id>",
    "status": "completed"
  }'
```

**DELETE** - Delete task
```bash
curl -X DELETE http://localhost:3000/api/tasks?id=<task-id>
```

---

### **5. VITALS** - `/api/vitals`
Log and monitor vital signs.

**GET** - Fetch vitals
```bash
curl http://localhost:3000/api/vitals?residentId=<resident-id>
```

**POST** - Log vitals
```bash
curl -X POST http://localhost:3000/api/vitals \
  -H "Content-Type: application/json" \
  -d '{
    "residentId": "<resident-id>",
    "type": "BLOOD_PRESSURE",
    "value": "120/80",
    "loggedById": "<staff-id>"
  }'
```

---

### **6. MESSAGES** - `/api/messages`
Internal messaging system.

**GET** - Fetch messages
```bash
curl http://localhost:3000/api/messages?from=<user-id>&to=<user-id>
```

**POST** - Send message
```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -d '{
    "from": "<staff-id>",
    "to": "<staff-id>",
    "text": "Patient needs assistance"
  }'
```

---

### **7. CALL BELLS** - `/api/callbells`
Emergency call bell management.

**GET** - Fetch call bells
```bash
curl http://localhost:3000/api/callbells?status=active
```

**POST** - Create call bell
```bash
curl -X POST http://localhost:3000/api/callbells \
  -H "Content-Type: application/json" \
  -d '{"residentId": "<resident-id>"}'
```

**PUT** - Acknowledge call
```bash
curl -X PUT http://localhost:3000/api/callbells \
  -H "Content-Type: application/json" \
  -d '{
    "id": "<callbell-id>",
    "acknowledgedBy": "<staff-id>"
  }'
```

---

### **8. STAFF** - `/api/staff`
Staff management and directory.

**GET** - Fetch staff
```bash
curl http://localhost:3000/api/staff?role=NURSE
```

**POST** - Add staff member
```bash
curl -X POST http://localhost:3000/api/staff \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice Johnson",
    "email": "alice@facility.com",
    "role": "NURSE",
    "department": "Medical",
    "phone": "555-0100",
    "hireDate": "2024-01-01"
  }'
```

---

### **9. TIME TRACKING** - `/api/timetracking`
Staff time and attendance tracking.

**GET** - Fetch time records
```bash
curl http://localhost:3000/api/timetracking?staffId=<staff-id>
```

**POST** - Clock in
```bash
curl -X POST http://localhost:3000/api/timetracking \
  -H "Content-Type: application/json" \
  -d '{"staffId": "<staff-id>"}'
```

**PUT** - Clock out / Start break / End break
```bash
curl -X PUT http://localhost:3000/api/timetracking \
  -H "Content-Type: application/json" \
  -d '{
    "id": "<timetracking-id>",
    "action": "clockOut"
  }'
```

Actions: `clockOut`, `startBreak`, `endBreak`

---

### **10. NOTES** - `/api/notes`
Medical and resident care notes.

**GET** - Fetch notes
```bash
curl http://localhost:3000/api/notes?residentId=<resident-id>&type=medical
```

**POST** - Create note
```bash
curl -X POST http://localhost:3000/api/notes \
  -H "Content-Type: application/json" \
  -d '{
    "residentId": "<resident-id>",
    "note": "Patient reported leg pain",
    "createdBy": "<staff-id>",
    "type": "medical"
  }'
```

---

## 📊 DATABASE MODELS (16 Total)

| Model | Relations | Purpose |
|-------|-----------|---------|
| User | residents, staff | Authentication & profiles |
| Resident | vitals, incidents, meds, tasks | Patient profiles |
| VitalsLog | resident | Health monitoring |
| Incident | resident | Safety events |
| Medication | resident | Medication tracking |
| Task | resident | Care tasks |
| Message | - | Staff communication |
| Staff | - | Staff directory |
| TimeTracking | - | Attendance |
| MedicalNote | resident | Clinical notes |
| CallBell | resident | Emergency calls |
| ShiftReport | - | Daily reports |
| Notification | - | Alert system |
| Visit | resident | Visitor log |
| Invoice | resident | Billing |
| ResidentNote | resident | Care notes |

---

## 🔐 Security Features

- ✅ Input validation on all endpoints
- ✅ Field sanitization
- ✅ Unique constraints (email, room numbers)
- ✅ Cascading deletes
- ✅ Proper HTTP status codes
- ✅ Error logging

---

## 📝 Environment Variables

```env
DATABASE_URL=postgresql://user:pass@localhost/dbname
DIRECT_URL=postgresql://user:pass@localhost/dbname
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
```

---

## 🚀 Deployment

**All-in-One Next.js Deployment to Vercel:**

1. Push to GitHub
2. Connect to Vercel
3. Set DATABASE_URL environment variable
4. Deploy (automatic)

**No separate backend needed!**

---

## ✅ Status

- ✅ 10 critical API routes implemented
- ✅ 16 database models
- ✅ Full CRUD operations
- ✅ Error handling
- ✅ Production ready
- ✅ Vercel compatible

All endpoints are tested and ready for integration with the frontend!
