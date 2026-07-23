# AGENTS.md — Assisted Living Platform

## Project Structure

Two apps in `apps/`:
- **`apps/frontend/`** — Next.js 16 + React 19 + Prisma ORM (npm workspace, the main app)
- **`apps/backend/`** — FastAPI + SQLAlchemy + asyncpg (separate Python venv at `apps/backend/.venv/`)

Root `package.json` scripts delegate to `apps/frontend/`.

## Dev Commands

```bash
# Frontend (from root or apps/frontend)
npm run dev          # next dev --hostname 0.0.0.0 (port 3000)
npm run build        # prisma generate && next build
npm run lint         # eslint (next/core-web-vitals + typescript configs)
al start             # alias for npm run dev
al build             # alias for npm run build

# Backend (from apps/backend, requires .venv active)
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Prisma (from apps/frontend)
npx prisma generate
npx prisma db push   # schema push (no migration files)
npx prisma studio    # visual DB browser
```

## Key Gotchas

- **TypeScript strict mode is OFF** (`apps/frontend/tsconfig.json`). All strict checks disabled. Don't expect type safety to catch errors.
- **Application Control policy** blocks `uvicorn.exe` on this machine. Always use `.\.venv\Scripts\python.exe -m uvicorn` instead.
- **No npm `exec`** — use `npx` directly.
- **Supabase pooler credentials** belong in local/deployment secrets only. URL-encode reserved password characters in connection strings.
- **`apps/backend/.env`** has live credentials (Supabase keys, DB URLs). Never commit this file.
- **Next.js 16 has breaking changes** from earlier versions. See `apps/frontend/node_modules/next/dist/docs/` before writing Next.js code.
- **Build requires Prisma generate first** — the `build` script runs `prisma generate && next build`.
- **Vercel deploy** uses `npm install --include=optional && npm rebuild lightningcss` as install command (see `vercel.json`).

## Architecture

- **Generic API route**: `apps/frontend/src/app/api/db/[model]/route.ts` handles CRUD for all Prisma models. Models must be registered in `apps/frontend/src/lib/models.ts`.
- **Role-based routing**: `apps/frontend/src/app/[role]/[tab]/page.tsx` renders all portals dynamically.
- **Auth is server-side only** via signed cookie (`apps/backend/app/auth.py`). No client-side `useAuth` hook exists.
- **Realtime**: `useLiveQuery` hook (`apps/frontend/src/lib/useLiveQuery.ts`) — Supabase subscriptions with polling fallback.
- **Facility config**: `useFacilityConfig()` hook reads `AppSetting` table. Never hardcode facility names/addresses.
- **Data rule**: ALL facility names, addresses, phone numbers, emails, rooms, person names, GPS coords must come from DB or env vars. Zero hardcoded data.

## Backend

- Entrypoint: `apps/backend/app/main.py`
- Auto-migrates DB on startup via SQLAlchemy `create_all`
- SQLAlchemy models in `app/models/portal.py` (14 models, 1:1 with Prisma tables)
- Pydantic schemas in `app/schemas/portal.py`
- CORS allows `localhost:3000` and the Vercel production URL

## Environment Files

- `apps/frontend/.env` — DATABASE_URL, Supabase keys, Gemini API key
- `apps/backend/.env` — DB URLs, camera config, Supabase keys
- `.env.example` — template with all required variables documented
