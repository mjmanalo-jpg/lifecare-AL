# Supabase bootstrap — spin up a new project

Recreates the **entire LifeCare CMS database** (schema + tenant RLS) on a fresh
Supabase project. Use this instead of `prisma/migrations/` — that folder is a
stale historical baseline (schema has since evolved via `prisma db push`).

Files:

| File | What it does | Committed? |
|------|--------------|:--:|
| `01_schema.sql` | 109 tables, 94 enums, indexes, FKs — the full current schema | yes |
| `02_tenant_rls.sql` | RLS helper functions + `tenant_isolation` policy on every org/community table, append-only `AuditLog`, per-user `Message`/`Notification` scoping | yes |
| `dump-live.sh` | Reads the **live** DB and writes the two data files below (read-only) | yes |
| `live_data_auth.sql` | `auth.users` + `auth.identities` from live — so existing logins/passwords keep working | **no** (PHI) |
| `live_data_public.sql` | All `public` application data from live | **no** (PHI) |

`01`/`02` mirror `prisma/schema.prisma`. Regenerate `01_schema.sql` any time with:

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/supabase-bootstrap/01_schema.sql
```

> **Two modes.** Empty schema only → do steps **A**. Full clone **with live data** → do
> steps **A + B**. The data path needs `pg_dump`/`psql` installed (**not present on
> this machine** — install the PostgreSQL client, major version ≥ the Supabase server,
> currently PG15/PG17).

---

## A. Stand up the new project (always)

### A1. Create the Supabase project
- Region: **Southeast Asia (Singapore)** — closest to us; avoids the Sydney latency the current project has.
- Save the DB password.

### A2. Grab connection strings (Project → Settings → Database)
- **Pooled** (port `6543`, `?pgbouncer=true`) → `DATABASE_URL`
- **Direct** (port `5432`) → `DIRECT_URL`  ← use this one for every `psql` below

### A3. Apply the schema
```bash
psql "$NEW_DIRECT_URL" -f prisma/supabase-bootstrap/01_schema.sql
```
No `psql`? Paste the file into the Supabase **SQL Editor** and run.

> **Now branch:** empty database → skip to **A4 (seed)**. Cloning live data → do **B** *before* A4-seed.

### A4. Point the app at the new project — `.env` / `.env.local`
```
DATABASE_URL=              # pooled (6543)
DIRECT_URL=                # direct (5432)
NEXT_PUBLIC_SUPABASE_URL=  # https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY= # Settings → API → service_role (server-only, never ship to client)
```
Then `npx prisma generate`.

**Seed (only for an EMPTY project — skip if you did B):**
```bash
node prisma/seed-auth.mjs   # Supabase Auth users (needs SERVICE_ROLE_KEY + SUPABASE_URL + SEED_ACCOUNT_PASSWORD)
node prisma/seed.mjs        # demo tenants/communities/residents
```

---

## B. Clone the LIVE data (only if copying existing data)

Order matters: **schema (A3) → auth data → public data → RLS**. RLS goes *last* so its
`WITH CHECK` doesn't reject rows during the bulk load, and auth loads before public so
existing `authUserId` links resolve to real accounts.

### B1. Dump from live (read-only)
```bash
OLD_DIRECT_URL="postgresql://postgres:<pw>@db.<oldref>.supabase.co:5432/postgres" \
  bash prisma/supabase-bootstrap/dump-live.sh
# → live_data_auth.sql + live_data_public.sql (git-ignored; contain PHI)
```

### B2. Load into the new project (after A3, replacing A4-seed)
```bash
psql "$NEW_DIRECT_URL" -f prisma/supabase-bootstrap/live_data_auth.sql    # auth.users + identities
psql "$NEW_DIRECT_URL" -f prisma/supabase-bootstrap/live_data_public.sql  # all application data
```
Then do **A4** (env + `prisma generate`) but **do NOT run the seed scripts** — the data is already there.

### B3. Finish with RLS
```bash
psql "$NEW_DIRECT_URL" -f prisma/supabase-bootstrap/02_tenant_rls.sql
```

---

## Verify (both modes)
```bash
npx prisma db pull --print   # should show no drift vs schema.prisma
```
- RLS on: Supabase → **Authentication → Policies** — every tenant table shows `tenant_isolation`.
- Log in and switch a couple of portals. For a clone, an existing real account should log in with its existing password.

---

## Notes
- **Empty project:** `01_schema.sql` → `02_tenant_rls.sql` → seed scripts. Auth users are
  created fresh by `seed-auth.mjs` via the Admin API.
- **Clone:** `auth.users`/`auth.identities` are dumped from live so accounts + password
  hashes carry over 1:1 (`authUserId` is `String? @unique`, an app-level link — not a DB FK —
  so the auth rows must be migrated for logins to work). Requires the two Supabase projects to
  be on compatible PG/gotrue versions (a project created now will be ≥ the old one — fine).
- `02_tenant_rls.sql` is schema-agnostic — it loops over tables having both `organizationId`
  and `communityId`, so it stays correct as the schema grows. Re-run it after any future
  migration that adds tenant-scoped tables.
- The RLS layer reads request context from `set_config('app.user_id', …)` (set per-request by
  the app) and falls back to `auth.uid()` for Supabase Realtime.
- No Supabase **Storage** buckets to migrate — uploads live on the app filesystem (`public/uploads`).
- `dump-live.sh` uses `--disable-triggers`; if the `postgres` role lacks permission for that,
  prepend `SET session_replication_role = replica;` to `live_data_public.sql` before loading.
