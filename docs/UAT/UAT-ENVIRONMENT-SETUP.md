# Frozen UAT Environment — Setup & Recommendation

**Why this exists:** UAT of a PHI product must run on a **fixed build** with **synthetic data**, isolated from production. Today the project deploys `main` straight to production against a single Supabase project — there is no such environment. This is the top blocker before UAT can start.

---

## 1. Current state (verified)

- **One** Vercel project, **one** Supabase project (single `NEXT_PUBLIC_SUPABASE_URL`), region `sin1` (`vercel.json`).
- `main` → auto-deploy to production. No staging branch, no second environment, no `.env.staging`.
- Consequence: any test would either hit production data or be done against a moving build. Neither is acceptable for PHI UAT.

## 2. Target: a dedicated, frozen UAT environment

```
                 ┌─────────────── PROD ───────────────┐
  main ─deploy──▶│ Vercel (prod)  ⇄  Supabase (prod)  │  real data
                 └────────────────────────────────────┘

                 ┌─────────────── UAT ────────────────┐
  uat  ─deploy──▶│ Vercel (preview/env) ⇄ Supabase    │  synthetic data only
   ▲             │  pinned commit SHA     (uat project)│  re-seedable
   └─ promote a reviewed SHA, then freeze
```

**Principles**
- **Separate Supabase project** for UAT — never point UAT at the prod DB.
- **Pin a commit SHA** for the UAT build; no pushes to it mid-cycle except approved defect fixes (record each in the defect log).
- **Synthetic residents only** — no real PHI in UAT.
- **Re-seedable** to a known baseline between test passes.

## 3. Setup steps (roughly half a day)

1. **Create a second Supabase project** (`lifecare-uat`). A reusable bootstrap bundle already exists at `apps/frontend/prisma/supabase-bootstrap/` — use it to stand up schema + policies.
2. **Turn on database RLS here first** (this is also the safe place to test it before prod):
   - `DB_RLS_GUCS=true` — activate the dormant Postgres RLS (`lib/tenantDb.ts:17`) and confirm reads/writes + Supabase Realtime still work.
   - *(MFA is intentionally out of scope — the client does not require it.)*
3. **Create a UAT environment in Vercel** (separate Environment or a dedicated project) with its **own env vars**: `SESSION_SECRET` (unique, non-default), `APP_DATABASE_URL`/`DIRECT_URL` (UAT), `SUPABASE_SERVICE_ROLE_KEY` (UAT), etc. Do **not** reuse prod secrets.
4. **Deploy a pinned SHA** and record it in the UAT test-plan header.
5. **Seed synthetic data** — a handful of fake residents spanning different acuity levels (so the LOC engine's determinism check in the test plan has varied inputs).
6. **Provision role test accounts** (Section 5 of the UAT test plan) against the UAT project.
7. **Smoke-test** the happy-path flow once before opening UAT to testers.

## 4. Guardrails during UAT

- **Freeze:** only approved defect fixes reach the UAT build; each bumps the recorded SHA and is noted in the defect log.
- **No prod data**, ever, in UAT.
- **Reset-to-baseline** capability between passes so results are reproducible.
- **Promotion:** only after UAT sign-off does the reviewed SHA get promoted to production — ideally behind a manual approval in Vercel rather than raw auto-deploy from `main`.

## 5. What this buys the PHI conversation

A frozen UAT environment is the difference between "we tested it" and "we tested *this exact build*, on isolated infrastructure, with no patient data at risk, and here's the sign-off." That's the standard a customer holding PHI is right to expect — and it doubles as the staging tier the project is currently missing for safe production releases.
