# 07 — COMPLETE SYSTEM STRUCTURE & SCHEMAS

> **STATUS: LIVE / AS-BUILT (2026-07)** — This document describes the system **as it
> actually runs today**, not an aspirational target. It supersedes any earlier draft
> that showed a 4-model schema, `Resident.sponsorId → User` as the only link, Server
> Actions in `src/actions/`, or Turborepo. Those never shipped. When code and this doc
> disagree, fix whichever is wrong and keep them in sync.

---

## 1. MONOREPO STRUCTURE (as-built)

```text
assisted-living/                 # plain npm workspaces (NO turbo.json)
├── .agents/                     # System blueprints & governance (this folder)
├── apps/
│   ├── frontend/                # 🖥️ NEXT.JS 16 (App Router) — the whole product
│   │   ├── prisma/
│   │   │   ├── schema.prisma     # SOURCE OF TRUTH (18 models)
│   │   │   └── seed.mjs          # idempotent seed
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── page.tsx              # public landing
│   │   │   │   ├── login/page.tsx        # role-select demo login
│   │   │   │   ├── [role]/[tab]/page.tsx # portal dispatcher (nurse/caregiver/family/superadmin)
│   │   │   │   └── api/                  # Next.js route handlers (the BFF)
│   │   │   ├── components/portal/        # views/, widgets/, ai/
│   │   │   ├── constants/roleConfig.ts   # roles, tabs, sidebar
│   │   │   └── lib/                      # prisma, auth, models, scope, api, useLiveQuery, adapters
│   │   └── package.json
│   └── backend/                 # ⚙️ FASTAPI (optional) — heavy vision/voice only
│       └── app/ (main.py, api/v1/{camera,voice,ehr}.py)
├── supabase/migrations/         # ⚠️ STALE — 0001_rls_setup.sql targets the old schema; not applied
└── package.json                 # workspace root
```

**Deployment:** Frontend → Vercel. Optional FastAPI → Docker (Cloud Run/Render). DB → Supabase Postgres.

---

## 2. DATA MODEL (Prisma — the 18 live models)

`apps/frontend/prisma/schema.prisma` is authoritative. Applied with `prisma db push` (no
`prisma/migrations/` folder). Grouped by domain:

| Domain | Models |
|---|---|
| **Identity** | `User` (role, email, **sponsoredResidents**), `Staff` (userId→User) |
| **Resident core** | `Resident` (**sponsorId → User**, careLevel, roomNumber), `ResidentNote`, `MedicalNote` |
| **Clinical** | `VitalsLog`, `Incident`, `Medication` |
| **Ops** | `Task`, `CallBell`, `ShiftReport`, `TimeTracking`, `Visit` |
| **Comms** | `Message`, `Notification` |
| **Billing** | `Invoice` |
| **AI** | `KnowledgeDoc`, `AppSetting` |

Key relationships: `Resident.sponsorId → User` scopes the **Family portal** to a sponsor's
own resident(s). `Staff.userId → User` (1-1). Almost every clinical/ops row hangs off
`Resident.id`. Enums: `Role, CareLevel, VitalType, TaskStatus, TaskPriority, IncidentType,
IncidentSeverity, MessageType, MedicationStatus, CallBellStatus, ShiftType, InvoiceStatus,
NotificationType, AttendanceStatus`.

> Roadmap phases (see the plan file) add: Diagnosis, LabResult, CarePlan, CarePlanTask,
> MedicationAdministration, Lead, Admission, Unit, WorkOrder, Event, ChargeTemplate,
> InvoiceLineItem, Payment, InventoryItem, StockLot, Vendor, PurchaseOrder, Asset, SurveyResponse.

---

## 3. API SURFACE (Next.js route handlers — `runtime = nodejs`, `dynamic = force-dynamic`)

The backbone is a **generic, model-driven CRUD API** — new models are exposed by
registering them in `src/lib/models.ts`, no new route files:

| Endpoint | Verbs | Purpose |
|---|---|---|
| `/api/db/[model]` | GET, POST | List (filter `f_*`, `include`, `take`, `order`) + create |
| `/api/db/[model]/[id]` | GET, PATCH, DELETE | Single-record read/update/delete |
| `/api/stats` | GET | Dashboard aggregates |
| `/api/vitals`, `/api/settings` | GET/POST | Focused helpers over VitalsLog / AppSetting |
| `/api/auth/session` | POST, DELETE | Create (role + resolved userId) / clear session |
| `/api/ai-assistant` | POST | chat · tts · stt · extract (ElevenLabs→Gemini→browser fallback) |
| `/api/ai-vision` | POST | CCTV emotion/behavior/fall analysis (Gemini → local landmarks) |

Whitelist enforced: only models in `MODELS` are reachable — unknown model → 404.

---

## 4. AUTH & ACCESS CONTROL (`src/lib/auth.ts` + `src/lib/scope.ts`)

- **Session:** HTTP-only cookie `golden_hearth_session`, **HMAC-SHA256 signed** with
  `SESSION_SECRET` (payload = `{ role, userId?, createdAt }`, base64url + `.sig`). Tampered
  or forged cookies fail `timingSafeEqual` and are rejected.
- **Helpers:** `getSession()` → `{role,userId}`; `validateSession()` → role (back-compat);
  `createSession(role, userId?)`; `requireSession()` (throws 401).
- **Self-service scoping (`scope.ts`):** every FAMILY/RESIDENT read through `/api/db` is
  AND-ed with an ownership `where` — FAMILY residents → `sponsorId = userId`, RESIDENT
  residents → `userId = userId` (own record); resident-scoped tables → `residentId ∈` their
  resident(s); messages/notifications → the user; everything else → denied. Writes limited to
  `messages` + `visits`; no deletes. Works live **and** in demo mode (`scopeDemoRows` pins
  self-service logins to the demo relative, Room 302), so the boundary is always visible.
- **Post-MVP hardening (documented, not built):** Supabase RLS + JWT as defense-in-depth
  behind the same scoping seam. The `supabase/migrations/0001_rls_setup.sql` is stale.

---

## 5. REALTIME · RESPONSIVE · DYNAMIC (how the "live" feel is achieved)

- **Realtime:** `src/lib/useLiveQuery.ts` subscribes to Supabase `postgres_changes`
  (INSERT/UPDATE/DELETE) on the model's table and refetches on any change — **plus a 20 s
  polling fallback** so data stays fresh even when websockets are unavailable. Mutations go
  through `src/lib/api.ts` (`createRecord/updateRecord/deleteRecord`) then `refetch()`.
- **Dynamic:** all API routes are `force-dynamic` (no stale cache); the whole portal is one
  dynamic `[role]/[tab]` route driven by `roleConfig.ts`; the model API is data-driven.
- **Responsive:** Tailwind CSS 4, mobile-first grids, Framer Motion transitions, Recharts
  for adaptive charts, SweetAlert2 for feedback.
- **Resilient:** when `DATABASE_URL` is unset, the API serves `src/lib/demoData.ts` so every
  screen is fully populated for demos with zero backend.

---

## 6. FRONTEND COMPOSITION

`[role]/[tab]/page.tsx` → `PortalShell` (sidebar/header from `roleConfig.ts`) →
`<Role>PortalContent.tsx` dispatcher → per-tab view in `components/portal/views/`.
Rows are normalized for display via `src/lib/adapters.ts`. Shared widgets: `StatCard`,
`ChartContainer`, `VitalsPanel`, `ResidentCard`, `AlertBanner`. Vision:
`components/CameraVisionFeed.tsx` (MediaPipe/TensorFlow pose + fall detection).
