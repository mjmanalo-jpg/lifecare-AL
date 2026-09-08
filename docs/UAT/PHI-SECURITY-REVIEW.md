# LifeCare SLMS / Care360 — PHI Data-Security Review

**Date:** 2026-09-08
**Method:** Evidence-based code audit (three parallel reviews: access scoping, audit/integrity, auth/encryption/env). Every claim below is traceable to a file:line; this is a *technical control review*, not a formal HIPAA certification.
**Bottom line:** Application-layer controls are **strong**. The two things that must be settled *before* UAT of a PHI product are (1) a **separate, frozen UAT environment** — none exists today — and (2) turning on the **defence-in-depth controls that are built but currently switched off** (database RLS, MFA).

---

## A. What we can honestly tell the customer today (verified strengths)

| Control | Evidence | Notes |
|---------|----------|-------|
| **Multi-tenant isolation, enforced on every data call** | `lib/tenant.ts:304-401` (`tenantWhere`), `403-428` (`sanitizeTenantWrite`); called in `api/db/[model]/route.ts:69` and `[id]/route.ts` | Community/resident/org scoping injected into every read; org+community re-injected on every write so a client can't write cross-tenant. |
| **Role-based access control (19 roles)** | `constants/roleConfig.ts`; write gates in `lib/residentAccess.ts:30-47`, `api/db/[model]/route.ts:292-295` | Sidebar + route + write-level gating. Only Nurse/CM/Superadmin write clinical models; only CM/Superadmin edit resident master profile. |
| **Caregivers see only their residents** | `lib/tenant.ts:256-289` | Scoped to active-shift schedule + explicit break-glass grants; off-shift → zero rows. |
| **Family/Resident scoped to their own record** | `lib/tenant.ts:342-353`, `lib/scope.ts` | Read-only, sponsor/userId-verified. |
| **Signed, tamper-evident sessions** | `lib/auth.ts:50-72` | HMAC-SHA256 signed cookie, constant-time compare, `httpOnly`, `secure` (prod), `sameSite=lax`, 8h TTL. |
| **Session secret fails closed in prod** | `lib/auth.ts:17-23` (verified) | If `SESSION_SECRET` is unset/default in production, the app **throws at runtime** rather than serving with a known key. (Hardening note below.) |
| **Password security** | `bcryptjs` cost 10 + Supabase Auth; `api/auth/session/route.ts:37-58` | bcrypt dev-fallback is **disabled in production** — prod authenticates against Supabase only. |
| **Append-only audit trail** | `prisma/…/tenant_rls/migration.sql:65-74` (RLS = SELECT/INSERT only, no UPDATE/DELETE); `lib/audit.ts:20-52` | Captures actor, role, action, entity, before/after, IP, UA, session, timestamp. DB physically rejects edits/deletes to audit rows. |
| **Audit snapshots exclude PHI** | `lib/audit.ts:54-66` | Before/after limited to a 23-field `SAFE_FIELDS` allowlist — no names, diagnoses, meds, contact details written into audit JSON. |
| **All CRUD through the data API is audited** | `api/db/[model]/route.ts:453-462`, `[id]/route.ts:156,191`; break-glass `api/caregiver/break-glass/route.ts:124-129` | CREATE/UPDATE/DELETE + emergency access logged. |
| **Record signing + lock** | `lib/signingPin.ts`; `api/db/[model]/[id]/route.ts:68-77,180-183` | 4-digit PIN, AES-256-GCM encrypted (`api/auth/signing-pin/route.ts:25-29`); signed records return HTTP 423 on edit/delete. |
| **Encryption at rest + in transit** | Supabase-managed Postgres (AES-256 at rest, TLS in transit); Prisma default `sslmode=require`; private storage bucket + signed URLs (`lib/supabaseStorage.ts:17`) | Infra-level encryption is provided by Supabase's managed platform. |
| **MFA capability exists** | `lib/supabaseAuth.ts:152-166` | TOTP enrol/verify via Supabase; assurance level (aal1/aal2) tracked in session. *Available but not enforced — the client does not require MFA; recorded as an accepted decision (Section E), not a gap.* |

---

## B. Gaps — prioritized honestly

### 🔴 Must resolve before UAT of a PHI product

1. **No separate / frozen environment.** One Vercel project, one Supabase project; `main` auto-deploys to production. There is no staging where UAT can run against a fixed build without touching live data. *This is the single biggest blocker* — details and fix in `UAT-ENVIRONMENT-SETUP.md`.
   - Evidence: single `NEXT_PUBLIC_SUPABASE_URL`, `vercel.json` region `sin1`, no `.env.staging`.

2. **Database Row-Level Security is built but dormant.** Postgres RLS policies exist (`prisma/supabase-bootstrap/02_tenant_rls.sql`) but are not activated for the app connection — `lib/tenantDb.ts:17` runs queries **without** the tenant GUCs unless `DB_RLS_GUCS==="true"` (not the default). So isolation today is **application-layer only**: correct as long as every endpoint calls `tenantWhere`, but a direct/compromised DB connection would bypass scoping. Turn it on and test in staging.

### 🟠 Should resolve before or during UAT

3. **Audit coverage had holes — now fixed (2026-09-08).** `api/settings/route.ts` and `api/inventory/mirror/route.ts` previously wrote without `logAudit()`. Both now emit audit entries (settings logs the key only, never the value, since some app-settings hold clinical data; inventory-mirror logs create/update/delete). Verify in the UAT build.

4. **Record-lock covers only shift reports.** `SIGN_LOCK` (`lib/signingPin.ts`) locks only `shift-reports`. Assessments, MAR/medication-administration, and incident reports remain editable after the fact. Extend the lock map to the clinical records that need tamper-evidence.

5. **No documented backup SLA.** Supabase point-in-time recovery is available (`DEPLOYMENT_CHECKLIST.md:71`) but RPO/RTO, retention window, restore-test cadence, and whether a HIPAA BAA is signed with Supabase are all unspecified. For PHI these need to be written down and, ideally, an off-platform encrypted export added.

### 🟡 Hardening (post-UAT acceptable, track them)

7. **App-layer scoping isn't enforced by a guard** — `tenantWhere` is called by hand on each route; a future endpoint that forgets it leaks silently. Add a shared wrapper / lint check. (Item 2's RLS is the belt-and-suspenders backstop.)
8. **Session-secret guard only catches the literal default** (`endsWith("change-me")`) and runs at first request, not at deploy time. A *different* weak secret wouldn't be caught. Add a deploy-time env check.
9. **Audit writes are fire-and-forget** (`lib/audit.ts:20-51`) — a failed audit write won't block the clinical write. Acceptable for availability; document the trade-off.
10. **No app-level field encryption for PHI** beyond Supabase's at-rest encryption; **no session rotation on role switch**; **no concurrent-session cap**. Defence-in-depth, not blockers.

---

## C. The short list to be "UAT-ready" on the PHI dimension

- [ ] Stand up the **frozen UAT environment** (separate Supabase + Vercel) — `UAT-ENVIRONMENT-SETUP.md`.
- [ ] **Activate RLS** (`DB_RLS_GUCS=true`) in staging and verify reads/writes + Realtime still work.
- [x] **Close the audit holes** in `/api/settings` and `/api/inventory/mirror` — done 2026-09-08.
- [ ] Write down the **backup SLA** and confirm a **Supabase HIPAA BAA** is in place (business/legal, not code).

MFA is intentionally out of scope (Section E). The remaining code/config items are small and we control them; the BAA is a commercial step to start now.

## E. Accepted decisions (not gaps)

- **MFA not enforced.** The client does not require multi-factor auth, so `requiresPrivilegedMfa` (`lib/tenant.ts:449`) intentionally returns `false`. The TOTP capability remains wired via Supabase and can be enabled later without code changes if a future client requires it. Recorded here so a security reviewer doesn't read the disabled state as an oversight.

---

## D. Open compliance questions (for the business, not the codebase)

- Is a **HIPAA Business Associate Agreement** signed with Supabase (and Vercel)? Managed AES-256 only counts toward compliance under a BAA.
- Required **audit-log retention** period (commonly 6 years) — currently no retention/deletion policy is enforced.
- Data-residency requirement? (Today: Singapore region, single region — availability risk, not confidentiality.)

*Prepared from a point-in-time code audit. Re-run after the fixes above land so the statement to the customer matches the shipped build.*
