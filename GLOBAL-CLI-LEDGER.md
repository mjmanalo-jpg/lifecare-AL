# GLOBAL-CLI-LEDGER.md — Persistent Memory Across All Sessions

> This file is auto-loaded by opencode as a global instruction.
> Update it whenever project state changes materially.

## Project: Assisted Living Platform
**Root:** `C:\Users\ResolutAI\Documents\assisted-living`
**Last verified:** 2026-07-17 — TypeScript 0 errors, ESLint 0 errors, build passes, 12 seed users with password auth

---

## Tech Stack
- **Frontend:** Next.js + Prisma ORM + React + TypeScript
- **Backend:** FastAPI (async SQLAlchemy + asyncpg) + Supabase PostgreSQL
- **Realtime:** `useLiveQuery` hook (Supabase subscriptions + polling fallback)
- **Auth:** Supabase Auth for deployed environments; isolated demo seeds require `SEED_ACCOUNT_PASSWORD`.
- **DB URL:** `postgresql://` (sync for Prisma); backend converts to `postgresql+asyncpg://`
- **Supabase pooler credentials:** stored only in local/deployment secret managers.

## Key Files
| File | Purpose |
|------|---------|
| `apps/frontend/prisma/schema.prisma` | Canonical DB schema (68+ models) |
| `apps/frontend/src/lib/models.ts` | Prisma model whitelist for API routes (50+ models) |
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
1. **Auth:** Server-side only via signed cookie. Email/password login with bcryptjs + demo role bypass. No client-side `useAuth` hook exists.
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

## Daily Rounds Module + Feature Matrix (2026-07-17)
LCMS Module 4 — Comprehensive Daily Rounds (10-area bedside documentation):
- Schema: 8 new enums (Shift, DailyRoundStatus, EdemaSeverity, MoodState, ConcernCategory, ConcernSeverity, MealType, AppetiteLevel, AssistanceLevel) + 11 models (DailyRound master + BowelRecord, UrineRecord, EdemaRecord, ConcernRecord, PainRecord, MoodRecord, SleepRecord, MobilityRecord, MealRecord, VitalSigns) — pushed to Supabase
- models.ts: all 11 registered (`daily-rounds`, `bowel-records`, `urine-records`, `edema-records`, `concern-records`, `pain-records`, `mood-records`, `round-sleep-records`, `mobility-records`, `meal-records`, `vital-signs`)
- `DailyRoundsBoard` (clinical/): resident picker → shift-based round lifecycle (start/complete) → 10 tabbed record types with add/delete forms; child queries filtered via `f_dailyRoundId` (generic API `f_` filter syntax — `where=` is NOT supported)
- `FeatureMatrixDashboard` (superadmin/): live system stats (12 models), 16 feature categories w/ model keys, role-access matrix, tech-stack panel
- Wired into 5 portals: superadmin (`dailyrounds` + `featurematrix`), nurse, caregiver, physician, facility_admin (each passes its own clinicianRole)
- Seed: 5 daily rounds across DAY/EVENING/NIGHT for rooms 302/305/310/312/308 covering all 10 areas (incl. escalated concerns, fall event, cardiac monitoring)
- Fixes along the way: missing `Droplets` import; SleepQuality form options matched to enum (RESTFUL/FAIR/POOR/RESTLESS/INSOMNIA); datetime-local → ISO; FeatureMatrix stats `take=1` → `take=1000`
- Build: ✓ compiled + type-checked clean

## Assessment & Level of Care — Real Acuity Engine (2026-07-17)
Root cause: /caregiver/rounds ("Assessment & Level of Care") rendered PhysicianRounds (a daily-rounding+vitals board). The real Assessment/AcuityScore models existed but had 0 rows, 0 UI, and 0 communities (Assessment.communityId is a required FK).
Fix — built the real engine:
- `AssessmentAcuityBoard` (clinical/): resident picker → 9-dimension scoring (ADL, cognition, mobility, medical, behavioral, nutrition, hydration, skin integrity, social engagement; 1–5 each) → live-computed acuity index %, AcuityLevel (LOW/MODERATE/HIGH/CRITICAL), CareLevel (INDEPENDENT/ASSISTED/MEMORY/SKILLED), daily care minutes + day/eve/night shift split + nurse/caregiver staffing demand + confidence. Saves Assessment + linked AcuityScore; shows per-resident history with score bars.
- Acuity math shared verbatim between seed.mjs and the component so data + UI agree. careLevel rule: cognition≥4 or behavioral≥4 → MEMORY; else pct<30 INDEPENDENT, <65 ASSISTED, else SKILLED.
- Repointed the `rounds` tab from PhysicianRounds → AssessmentAcuityBoard across ALL portals (caregiver/nurse/superadmin/facility_admin/physician-legacy/driver/fleet); removed now-unused PhysicianRounds imports. Physician "Assessment & Level of Care" stays on `casereview` → PhysicianCaseReview. PhysicianRounds.tsx now orphaned (kept on disk).
- Seed: created Organization + Community, backfilled all residents.communityId, seeded 4 assessments (rooms 310/302/312/305) spanning LOW→HIGH acuity, and synced resident.careLevel to the computed level.
- Gotcha: `prisma generate` throws EPERM on the query-engine DLL while the dev server holds it locked → run `npx next build` directly to skip regeneration when schema is unchanged. Build verified clean.

## Resident Registration — 7-step with credentials + facial enrollment (2026-07-17)
New self-service resident enrollment wizard modeled on the Admissions 7-step flow, adding auth + biometrics:
- Steps: (1) Account — email + password + confirm; (2) Personal; (3) Facial Enrollment — live webcam capture of 4 poses (left/right/up/down) with per-pose retake + file-upload fallback; (4) Medical; (5) Care & Room (careLevel + room required, auto-picks first available); (6) Care Plan; (7) Review & Register.
- Component: `components/portal/views/ResidentRegistration.tsx` — realtime via useLiveQuery (residents + rooms); list of registered resident logins with face-enrolled badge; getUserMedia camera lifecycle bound to step 3; canvas snapshot → mirrored JPEG data URL.
- Server route: `POST /api/register/resident` — bcrypt-hashes password, creates User(role RESIDENT) + Resident(linked userId, photoUrl) + 4 ResidentDocument rows (documentType FACE_ENROLLMENT, isConfidential) for the poses. Validates email/password/name/careLevel/room; 409 on duplicate email or occupied room.
- Face images uploaded client-side via existing /api/upload (writes to public/uploads/residents/faces, returns URL); falls back to inline data URL if upload fails.
- Wired into SuperAdmin: tab `registration` → "Resident Registration" (sidebar link w/ ScanFace icon, ROUTE_TO_TAB + GLOBAL_FEATURES entries). No schema change — reused Resident.photoUrl + ResidentDocument.
- Build: npx next build clean (exit 0); new route shows as ƒ /api/register/resident.

## Public /register + login link (2026-07-17)
The login page had no path to registration; the wizard lived only behind the SuperAdmin login. Added a public entry point:
- New public route `/register` (app/register/page.tsx) renders `<ResidentRegistration variant="public" />` on a gradient full-page.
- `ResidentRegistration` now takes `variant` ("admin" | "public"). Public mode: hides the admin list/stats, opens the wizard immediately, disables the residents/rooms useLiveQuery (`enabled:false` — pre-auth would 401), defaults careLevel to INDEPENDENT, skips the room-selection step (shows "assigned by facility"), and routes to /login on close/success.
- `/api/register/resident` now auto-assigns the first unoccupied room when `roomNumber` is omitted (public path); admin path still passes an explicit room. 409 if no rooms free.
- Login page (`app/login/page.tsx`): added "New resident? Create an account" → /register link under the Sign In button.
- Build: npx next build clean (exit 0); routes now include ○ /register.
Note: /register + /api/register/resident are intentionally public (no auth) so prospective residents can self-enroll. Flag if this should instead be staff-gated.

## Staff/Room/Resident counts now realtime in org-admin Communities (2026-08-08)
Root cause: Golden Hearth org had 24 members but only 8 Staff rows (community showed 8 Staff). Staff-like accounts created via seed/leadership flows lacked a Staff profile. Fix = data repair + flow guard + realtime counts:
- **Backfill (production):** created 14 missing Staff profiles across Golden Hearth (12), DevTest (1), Sunrise (1) — position derived from role, linked to their active community membership, isActive/isApproved true. Golden Hearth community Staff now 20 (= active community memberships), org staff 20, community memberships 20. Residents (7) + rooms (12) already had communityId — no backfill needed. Temp audit/backfill scripts deleted after run.
- **Flow fix:** `api/invitations/[token]/accept/route.ts` now upserts a Staff profile (checked-input form: `user/`organization`/`community` connect + required `hireDate`) when accepting a staff community role (FACILITY_ADMIN/BILLING_ADMIN/PHYSICIAN/NURSE/CAREGIVER/FLEET_MANAGEMENT/DRIVER) and the user has no Staff row in another org. (POST invite route already created Staff rows.)
- **Beds realtime:** `api/organization-admin/overview/route.ts` `_count` now includes `rooms: true`; Communities card Beds shows live Room count (`rooms / capacity` when bedsTotal set) instead of static bedsTotal.
- **Cache invalidation:** generic `/api/db/[model]` POST and `/api/db/[model]/[id]` PATCH/DELETE now `invalidatePortalDataPrefix("org-admin:{orgId}:")` on residents/rooms/staff changes so overview counts refresh on next poll.
- **Client realtime:** `OrganizationAdminPortalContent` now polls `/api/organization-admin/overview` silently every 20s (loading spinner suppressed on background refresh; replaces the single on-mount fetch). useLiveQuery not used here — its realtime channel + generic API are single-community scoped, but the org-admin view spans all communities.
- Uncommitted (from earlier): org-admin invoice amounts use `PHP/₱` only (removed `$`) via `Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 })`.
- Build: `npx next build` clean (exit 0) after all edits.

## Admin bells scoped to function — no clinical/facility alerts for platform/org admin (2026-08-08)
`PortalShell.tsx` notification filter extended so admin tiers only see alerts within their function:
- `FACILITY_ADMIN` (unchanged): hides clinical types + clinical entity types; still sees operational facility alerts (inventory, maintenance, dining, concierge, camera).
- `ORGANIZATION_ADMIN` / `PLATFORM_ADMIN` (new): also exclude facility-operational alerts (`TRANSPORT_UPDATE` type + entities purchaseRequest/serviceRequest/maintenance/diningReservation/conciergeBooking/inventoryItem/camera/trip) and resident/family billing (`BILLING_UPDATE` + entity `invoice`). They keep subscription billing (`BILLING_UPDATE` + entity `subscription`), security, and system-level alerts.
- Added `INCIDENT_REPORT` to `CLINICAL_NOTIF_TYPES` (previously only caught via the `incident` entity). `facilityOps` flag → `scopeRole` switch.
- Build: `npx next build` clean (exit 0). Single file change, not yet committed.

## Platform admin notified on new customer signups + subscription payments (2026-08-08)
New `lib/platformNotify.ts` helper fans a business alert out to every active PLATFORM_ADMIN user (best-effort, never throws). Wired into:
- `api/register/organization/route.ts` — "New organization registered": org name + owner + email + plan (30-day trial), severity WARNING, entity `organization`. Fires on the public `/signup` + `/checkout/[plan]` path.
- `api/organization-admin/billing/route.ts` — "Subscription payment received": org name + amount + plan + invoice number, severity WARNING, entity `subscription`. Fires when a payment settles and the subscription advances to ACTIVE (simulated-checkout path; real hosted-checkout stays PENDING — no webhook/confirmation handler exists yet).
- These pass the new bell scope filter (SYSTEM_ALERT type, entities `organization`/`subscription` are not in the clinical/facility exclusion sets).
- Build: `npx next build` clean (exit 0). Not yet committed.

## Notifications now route to their exact sidebar tab (2026-08-08)
Replaced the fuzzy keyword routing in `PortalShell.tsx` with an explicit notification→sidebar-tab map:
- `NOTIF_TARGET_ROUTES` — keyed by `relatedEntityType` (precise: SYSTEM_ALERT alone covers inventory/camera/subscription/system-health/…). Each key maps to an ordered list of candidate route segments; the first tab the role actually has in its sidebar wins (`l.route.endsWith("/segment")` exact match), so clicks land on a real page.
- `NOTIF_ROUTE_BY_TYPE` — type-based fallback for alerts without an entity (demo data): SYSTEM_ALERT → `health` (System Health) when present else dashboard; BILLING_UPDATE → invoices/expenses/subscription.
- `NOTIF_ROUTE_QUERY` — preserved deep-links, e.g. diningReservation → `/facility_admin/community?subtab=dining`.
- Examples that now land correctly: platform-admin "Supabase Connection Healthy"/system alerts → System Health; org "New organization registered" → Customer Workspaces; org-admin subscription reminders → Usage & Subscription; platform subscription payments → Usage & Capacity; camera offline → Camera Registry; trips → Trip Board; family invoice → Family Billing.
- Build: `npx next build` clean (exit 0). `PortalShell.tsx` only, not yet committed.

## Shift Report Convention (2026-08-18)
All shift reports follow a standardized format defined in `SHIFT_REPORT_TEMPLATE.md`:
- **No engineer names** — keep it impersonal and professional
- **Paragraph-based** — bold section headers followed by descriptive paragraphs, not dense tables
- **Bullet points** for metrics and risks, not grid tables
- **Structure:** Overview → Workstream 1 (bold per phase/module) → Workstream 2 → Deployment Summary → Risks & Follow-Up
- **File naming:** `SHIFT_REPORT_YYYY-MM-DD.md` (local only, never committed)
- **Example:** `SHIFT_REPORT_2026-08-18.md`
