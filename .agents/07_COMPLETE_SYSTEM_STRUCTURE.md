# 07 COMPLETE SYSTEM STRUCTURE & SCHEMAS

## 1. COMPLETE MONOREPO FOLDER STRUCTURE
```text
home-for-the-aged/
├── .agents/                    # System Blueprints & Ledger
├── .github/workflows/          # CI/CD Pipelines
├── packages/                   # Shared libraries
│   ├── config/                 # Shared TS configs, ESLint
│   └── ui/                     # Shared UI components (optional if isolated)
├── apps/
│   ├── frontend/               # 🖥️ NEXT.JS APPLICATION
│   │   ├── prisma/             # PRISMA SCHEMA (Source of Truth)
│   │   ├── src/
│   │   │   ├── app/            # App Router (Views)
│   │   │   │   ├── (auth)/     # Login / OTP
│   │   │   │   ├── admin/      # Super Admin Dashboard
│   │   │   │   ├── nurse/      # Clinical Dashboard
│   │   │   │   ├── family/     # Sponsor Read-Only Portal
│   │   │   │   └── api/        # Next.js BFF Routes
│   │   │   ├── components/     # UI Atoms/Molecules
│   │   │   ├── actions/        # Server Actions (Mutations)
│   │   │   └── lib/            # Supabase/Prisma clients
│   │   ├── package.json
│   │   └── tailwind.config.js
│   │
│   └── backend/                # ⚙️ FASTAPI PYTHON APPLICATION
│       ├── app/
│       │   ├── main.py         # Entrypoint
│       │   ├── api/            # API SCHEMA ROUTERS
│       │   │   ├── v1/
│       │   │   │   ├── voice.py   # Voice AI Endpoints
│       │   │   │   ├── camera.py  # Optical Matrix Endpoints
│       │   │   │   └── ehr.py     # Heavy Data Sync
│       │   ├── core/           # Configs, Security
│       │   ├── models/         # Pydantic Schemas
│       │   └── services/       # AI & Computer Vision Logic
│       ├── requirements.txt
│       └── Dockerfile
├── supabase/                   # 🗄️ SUPABASE CONFIG
│   ├── migrations/             # Raw SQL Migrations
│   └── config.toml
├── GLOBAL-CLI-LEDGER.md
└── turbo.json                  # Turborepo Config
```

---

## 2. PRISMA SCHEMA (MODEL SCHEMA)
*File: `apps/frontend/prisma/schema.prisma`*
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

model User {
  id        String   @id @default(uuid())
  role      Role     @default(FAMILY)
  email     String   @unique
  name      String
  residents Resident[] // A family sponsor can have multiple residents
}

model Resident {
  id           String      @id @default(uuid())
  name         String
  careLevel    CareLevel
  roomNumber   String
  sponsorId    String
  sponsor      User        @relation(fields: [sponsorId], references: [id])
  vitals       VitalsLog[]
  incidents    Incident[]
}

model VitalsLog {
  id         String   @id @default(uuid())
  residentId String
  resident   Resident @relation(fields: [residentId], references: [id])
  type       VitalType // BP, HR, TEMP
  value      String
  recordedAt DateTime @default(now())
  loggedById String   // ID of Nurse
}

enum Role { SUPERADMIN, NURSE, CAREGIVER, FAMILY }
enum CareLevel { INDEPENDENT, ASSISTED, MEMORY, SKILLED }
enum VitalType { BLOOD_PRESSURE, HEART_RATE, TEMPERATURE, OXYGEN }
```

---

## 3. SQL SCHEMA (SUPABASE RLS EXTENSIONS)
*File: `supabase/migrations/0001_rls_setup.sql`*
```sql
-- Enable Row Level Security (RLS)
ALTER TABLE "Resident" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VitalsLog" ENABLE ROW LEVEL SECURITY;

-- Policy: Nurses can read/write all residents
CREATE POLICY "Nurses full access" ON "Resident"
  FOR ALL USING (auth.jwt() ->> 'role' IN ('NURSE', 'SUPERADMIN'));

-- Policy: Family can only read their sponsored resident
CREATE POLICY "Family read own resident" ON "Resident"
  FOR SELECT USING (auth.uid() = "sponsorId");

-- Policy: Family can only read vitals of their sponsored resident
CREATE POLICY "Family read own vitals" ON "VitalsLog"
  FOR SELECT USING (
    "residentId" IN (SELECT id FROM "Resident" WHERE "sponsorId" = auth.uid())
  );
```

---

## 4. API SCHEMA (FASTAPI)
*File: `apps/backend/app/main.py` & routers*

**Prefix:** `/api/v1`

| Endpoint | Method | Payload (Pydantic Model) | Description |
|---|---|---|---|
| `/voice/process` | `POST` | `{ "audio_blob": str, "nurse_id": str }` | Streams audio to LLM, transcribes, and executes intent (e.g., logging vitals). Returns success confirmation. |
| `/voice/query` | `POST` | `{ "query": str, "resident_id": str }` | LLM queries database for resident status and returns conversational audio summary. |
| `/camera/stream` | `WS` | `WebSocket connection` | Ingests real-time WebRTC camera feed. |
| `/camera/anomaly`| `POST` | `{ "timestamp": str, "location": str, "type": "FALL" }` | Internal endpoint triggered by CV model. Writes alert to Supabase to trigger realtime Next.js push. |
| `/ehr/sync` | `POST` | `{ "batch_data": list }` | Heavy data sync for migrating legacy data or batch processing. |

---

## 5. NEXT.JS SERVER ACTIONS (LIGHT API)
*File: `apps/frontend/src/actions/`*
- `logVitalSign(residentId, type, value)` -> Direct Prisma write.
- `assignCaregiver(residentId, nurseId)` -> Direct Prisma write.
- `generateMonthlyInvoice(sponsorId)` -> Triggers Stripe API and Prisma write.
