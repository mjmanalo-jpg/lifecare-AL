# GLOBAL-CLI-LEDGER.md — Persistent Memory Across All Sessions

> This file is auto-loaded by opencode as a global instruction.
> Update it whenever project state changes materially.

## Project: Assisted Living Platform
**Root:** `C:\Users\ResolutAI\Documents\assisted-living`
**Last verified:** 2026-07-13 — TypeScript 0 errors, ESLint 0 errors, all 11 routes 200 OK, build passes

---

## Tech Stack
- **Frontend:** Next.js + Prisma ORM + React + TypeScript
- **Backend:** FastAPI (async SQLAlchemy + asyncpg) + Supabase PostgreSQL
- **Realtime:** `useLiveQuery` hook (Supabase subscriptions + polling fallback)
- **DB URL:** `postgresql://` (sync for Prisma); backend converts to `postgresql+asyncpg://`
- **Supabase pooler password** contains `@`: `0933016007@Paul`

## Key Files
| File | Purpose |
|------|---------|
| `apps/frontend/prisma/schema.prisma` | Canonical DB schema (38+ models) |
| `apps/frontend/src/lib/models.ts` | Prisma model whitelist for API routes |
| `apps/frontend/src/lib/useLiveQuery.ts` | Realtime data hook |
| `apps/frontend/src/lib/useFacilityConfig.ts` | Facility settings from AppSetting table |
| `apps/frontend/src/lib/api.ts` | `createRecord`, `updateRecord`, `deleteRecord` |
| `apps/frontend/src/app/api/db/[model]/route.ts` | Generic Prisma API route |
| `apps/frontend/src/app/[role]/[tab]/page.tsx` | Dynamic route rendering all portals |
| `apps/frontend/src/constants/roleConfig.ts` | Role definitions, sidebar links |
| `apps/backend/app/main.py` | FastAPI entrypoint, all routers |
| `apps/backend/app/auth.py` | Supabase JWT auth (server-side only) |
| `apps/backend/app/realtime.py` | WebSocket ConnectionManager |
| `apps/.env` | DATABASE_URL, SUPABASE keys |

## Architecture Rules
1. **Auth:** Server-side only via signed cookie. No client-side `useAuth` hook exists.
2. **Facility Config:** `AppSetting` table keys: `facility_name`, `facility_address`, `facility_phone`, `facility_email`, `facility_subtitle`, `facility_footer`, `facility_map_url`. Use `useFacilityConfig()` hook.
3. **Site Content:** Landing page copy in `SiteContent` table. Edited via LandingCustomizer.
4. **Rooms:** `Room` table. Never hardcode room pools.
5. **Physician names:** Query `Staff` + `User` tables where position contains "PHYSICIAN"/"DOCTOR".
6. **Dietitian names:** Query `Staff` + `User` tables where position contains "DIETITIAN"/"NUTRITION".
7. **NO HARDCODED DATA:** All facility names, addresses, phone numbers, emails, room numbers, person names, scores, GPS coordinates MUST come from DB or env vars.
8. **Application Control policy** blocks `uvicorn.exe` — use `.\.venv\Scripts\python.exe -m uvicorn`.
9. **No npm `exec`** — use `npx` directly.

## Static Data Audit — CLEAN (2026-07-13)
Zero instances of hardcoded data in portal components:
- "Golden Hearth" → `useFacilityConfig` hook
- "Clara Vance" → Staff table query
- "Arthur Pendelton" / "302" → URL search params
- "Dr. Alan Reyes" → Staff+User table query
- `MOCK_VITALS_TREND` → `EMPTY_VITALS_TREND = []`
- `ROOM_POOL` → Room table query
- localStorage for incidents → removed
- Fabricated vitals (72/98/36.8) → returns "—" when no DB data
- Hardcoded GPS → env vars `NEXT_PUBLIC_FACILITY_LAT`/`LNG`
- Compliance scores/auditor names → user-input-driven

## Portal Routes (all verified 200 OK)
- `/resident/dashboard`, `/nurse/dashboard`, `/nurse/monitoring`
- `/physician/dashboard`, `/physician/rounds`, `/physician/orders`, `/physician/notes`, `/physician/messages`
- `/driver/dashboard`, `/family/dashboard`, `/admin/dashboard`

## Prisma Models Registered in models.ts
`app-settings`, `rooms`, `staff`, `residents`, `vitals`, `medications`, `incidents`,
`medical-notes`, `messages`, `invoices`, `service-charges`, `payments`,
`insurance-validations`, `food-compliance-logs`, `dietitian-consults`,
`daily-menus`, `resident-goals`, `medication-logs`,
`fuel-logs`, `trips`, `drivers`, `vehicles`, `transport-requests`,
`vehicle-maintenance`, `site-content`, `custom-pages`, `users`, `tasks`, `audit-logs`

## WebSocket Endpoints
`/ws/ai-companion/{user_id}`, `/ws/call-bell`, `/ws/nurses`, `/ws/messages/{user_id}`

## Known Limitations
- No client-side auth context (physician names resolved via staff table query, not per-user identity)
- `SELF_WRITABLE` set in route.ts controls which models residents/drivers can write to
- LandingCustomizer FALLBACKS object has empty contact fields (intentionally — populated via SiteContent DB)

## Backend (FastAPI)
- 49 REST endpoints + 4 WebSocket endpoints
- SQLAlchemy models in `app/models/portal.py` (14 models) — 1:1 mapping to Prisma tables (camelCase)
- Pydantic schemas in `app/schemas/portal.py` (30+ schemas)
- Auto-migration on startup via lifespan
