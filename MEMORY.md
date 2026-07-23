# Project Memory — Assisted Living Platform

## Tech Stack
- **Frontend:** Next.js, Prisma ORM, React, TypeScript
- **Backend:** FastAPI (async SQLAlchemy + asyncpg), Supabase PostgreSQL
- **Realtime:** `useLiveQuery` hook (Supabase subscriptions + polling fallback)
- **DB URL:** `postgresql://` (sync for Prisma); backend converts to `postgresql+asyncpg://`

## Key Files
- `apps/frontend/prisma/schema.prisma` — canonical DB schema (38+ models)
- `apps/frontend/src/lib/models.ts` — Prisma model whitelist for API routes
- `apps/frontend/src/lib/useLiveQuery.ts` — realtime data hook
- `apps/frontend/src/lib/useFacilityConfig.ts` — facility-level settings hook (queries AppSetting)
- `apps/frontend/src/lib/api.ts` — `createRecord`, `updateRecord`, `deleteRecord` helpers
- `apps/frontend/src/app/api/db/[model]/route.ts` — generic Prisma API route
- `apps/frontend/src/app/[role]/[tab]/page.tsx` — dynamic route rendering all portals
- `apps/backend/app/main.py` — FastAPI entrypoint
- `apps/backend/app/auth.py` — Supabase JWT auth (server-side only)
- `apps/.env` — DATABASE_URL, SUPABASE keys

## Architecture Notes
- **Auth:** Server-side only via signed cookie. No client-side `useAuth` hook.
- **Facility Config:** Stored in `AppSetting` table (key/value). Keys: `facility_name`, `facility_address`, `facility_phone`, `facility_email`, `facility_subtitle`, `facility_footer`, `facility_map_url`. Use `useFacilityConfig()` hook.
- **Site Content:** Landing page copy stored in `SiteContent` table (key/value). Edited via LandingCustomizer.
- **Rooms:** Exist in `Room` table. Queried dynamically (no hardcoded room pools).
- **Physician names:** Queried from `Staff` table with position containing "PHYSICIAN"/"DOCTOR", joined with `User` for firstName/lastName.
- **Dietitian names:** Queried from `Staff` table with position containing "DIETITIAN"/"NUTRITION".
- **No hardcoded data rule:** All facility names, addresses, phone numbers, emails, room numbers, person names, scores, GPS coordinates must come from DB or env vars. Never hardcode.
- **Application Control policy** blocks `uvicorn.exe` — must use `.\.venv\Scripts\python.exe -m uvicorn`.
- **Supabase pooler credentials:** stored only in local/deployment secret managers; URL-encode reserved characters.

## Verified Working (as of 2026-07-13)
- TypeScript build: **0 errors**
- All 11 portal routes: **200 OK**
  - `/resident/dashboard`, `/nurse/dashboard`, `/nurse/monitoring`
  - `/physician/dashboard`, `/physician/rounds`, `/physician/orders`, `/physician/notes`, `/physician/messages`
  - `/driver/dashboard`, `/family/dashboard`, `/admin/dashboard`
- Zero hardcoded person names, facility names, mock data, fabricated scores, or localStorage data in portal components (except theme preference in PortalShell)

## Static Data Audit — CLEAN
Final scan confirms zero instances of:
- "Golden Hearth" (facility name) — now DB-driven via `useFacilityConfig`
- "Clara Vance" (dietitian) — now DB-driven via Staff table
- "Arthur Pendelton" / "302" (nurse monitoring) — now from URL search params
- "Dr. Alan Reyes" (physician) — now DB-driven via Staff+User tables
- `MOCK_VITALS_TREND` — renamed to `EMPTY_VITALS_TREND = []`
- `ROOM_POOL` (hardcoded 301-340) — now queries Room table
- `localStorage` for incidents — removed, in-memory only
- Fabricated vital signs (72/98/36.8) — returns "—" when no DB data
- Hardcoded GPS coordinates — now from env vars `NEXT_PUBLIC_FACILITY_LAT`/`LNG`
- Hardcoded compliance scores (95/100) — now user-input-driven
- Hardcoded auditor names ("Facility Admin") — now user-input-driven

## Prisma Models Registered in models.ts
`app-settings`, `rooms`, `staff`, `residents`, `vitals`, `medications`, `incidents`,
`medical-notes`, `messages`, `invoices`, `service-charges`, `payments`,
`insurance-validations`, `food-compliance-logs`, `dietitian-consults`,
`daily-menus`, `resident-goals`, `medication-logs`,
`fuel-logs`, `trips`, `drivers`, `vehicles`, `transport-requests`,
`vehicle-maintenance`, `site-content`, `custom-pages`, `users`, `tasks`, `audit-logs`

## Known Limitations
- No client-side auth context (physician names resolved via staff table query, not per-user identity)
- `SELF_WRITABLE` set in route.ts controls which models residents/drivers can write to
- No npm `exec` available — must use `npx` directly
