# 🏆 Architecture Best Practices & Clean-Code Standards

> **STATUS: LIVE / AS-BUILT (2026-07)** — Standards for how this codebase is *actually*
> written. Earlier drafts prescribed Server Actions (`src/actions/`), `prisma migrate`,
> and Supabase RLS as the primary access control — none of which shipped. The real
> patterns are below; follow them for consistency. Aspirational items are clearly marked
> **POST-MVP**.

---

## 1. DEPLOYMENT — "Split Hosting"

- **Frontend + BFF (Next.js 16):** Vercel. Serves the UI **and** all core API route
  handlers (`app/api/**`). This is the whole product for normal use.
- **Optional heavy compute (FastAPI):** Docker on Cloud Run / Render — only for
  long-running WebRTC camera streams and voice AI that would exceed serverless limits.
- **Database:** Supabase Postgres. `DATABASE_URL` (pooled, 6543) for queries, `DIRECT_URL`
  (5432) for schema pushes.
- **Monorepo:** plain **npm workspaces** (there is no `turbo.json`; don't assume Turborepo).

---

## 2. THE MODULE RECIPE (how every feature is added)

Consistency comes from one repeated pattern, not bespoke plumbing per feature:

1. **Model** → add to `apps/frontend/prisma/schema.prisma` (uuid id, `createdAt/updatedAt`,
   FK + indexes). `schema.prisma` is the single source of truth.
2. **Register** → add the kebab key to `src/lib/models.ts` (`delegate`, `table`, `orderBy`).
   This alone exposes full CRUD at `/api/db/<key>` — **no new route file**.
3. **Demo data** → `src/lib/demoData.ts` (+ `prisma/seed.mjs`) so it works with no DB.
4. **View** → `components/portal/views/`, wired into the role dispatcher + `roleConfig.ts`.
   Read with `useLiveQuery`, mutate with `src/lib/api.ts`, normalize with `adapters.ts`.
5. **Integration seams** → external services live behind an interface in
   `src/lib/integrations/` with an in-app stub; modules never import a vendor SDK directly.

---

## 3. CLEAN-CODE STANDARDS

### A. Next.js / React / TypeScript
1. **No `any` in feature code.** The one sanctioned exception is `ModelDef.delegate` (Prisma
   delegates share no public type) — already isolated in `models.ts`.
2. **Client components where interactive.** Portal views are `"use client"` because they use
   `useLiveQuery`, state, and handlers. Keep pure/presentational pieces server-renderable.
3. **Data access is API-first, not Server Actions.** Reads via `useLiveQuery(model,…)`;
   writes via `createRecord/updateRecord/deleteRecord`. (No `src/actions/` — that pattern
   was never adopted.)
4. **Realtime + responsive by default.** Pass `tables:[…]` to `useLiveQuery` for live
   updates; rely on the 20 s poll fallback. Layouts are mobile-first Tailwind.
5. **Type-check gate:** `npx tsc --noEmit` must be clean before shipping.

### B. Database / Prisma (Supabase)
1. **Source of truth:** `schema.prisma`. Apply with **`prisma db push`** (this project has no
   `prisma/migrations/`). Additive, nullable columns are safe; coordinate destructive changes.
2. **Whitelist access:** only models registered in `models.ts` are reachable — new tables are
   invisible to the API until explicitly added.
3. **Realtime pub/sub:** enable the table for Supabase Realtime so `useLiveQuery` receives
   `postgres_changes`. Polling still covers gaps.

### C. FastAPI (only if used)
Pydantic validation, `Depends()` injection, `async def` I/O, routers split by domain.

---

## 4. SECURITY & PRIVACY

- **Signed sessions (LIVE):** `golden_hearth_session` is HMAC-SHA256 signed via
  `SESSION_SECRET`; role **and** `userId` are tamper-proof. Set a strong `SESSION_SECRET`
  in every non-local environment.
- **Self-service data boundary (LIVE):** `src/lib/scope.ts` restricts every FAMILY read to
  that sponsor's resident(s) and every RESIDENT read to their own record; writes limited to
  messages/visits; no deletes. Enforced live and in demo mode.
- **HIPAA posture:** camera frames processed on the edge / in RAM; only incident-triggered
  clips persist.
- **POST-MVP (documented, not built):** Supabase Row Level Security + JWT as
  defense-in-depth *behind* the existing `scope.ts` seam — add without rewriting features.
  Until then, do **not** assume RLS is enforcing anything.

---

## 5. DEFINITION OF DONE (per feature)
`prisma validate` ✓ · registered in `models.ts` ✓ · demo data renders with no DB ✓ ·
`tsc --noEmit` clean ✓ · realtime + poll verified ✓ · FAMILY scoping honored ✓ ·
external calls behind an `integrations/` seam ✓.
