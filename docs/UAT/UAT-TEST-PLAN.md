# LifeCare SLMS / Care360 — UAT Test Plan

**Status:** Draft for review
**Owner:** Dev (Mark Jeferson Manalo) · Clinical validation (Myla Reyes)
**Product handles PHI** — this plan is a guardrail, not a formality. UAT does not start until the Entry Criteria below are all met.

---

## 1. Purpose & scope

Validate, with real users on a frozen build, that the **end-to-end clinical workflow** produces correct, safe, and reviewable output before release:

> Pre-admission → LifeCare 14-domain assessment → Level of Care (LOC) → Care Plan (nurse approval) → 24-hour resident routine → Caregiver task dashboard.

Plus the supporting role dashboards (Care360) that each role uses to do their job.

**In scope:** the flow above, per-role dashboards, access control, audit trail, sign/lock on clinical records.
**Out of scope for this cycle (note explicitly to stakeholders):** online payment provider (gated off), any module still on a feature branch not merged to the UAT build.

---

## 2. Entry criteria — UAT does NOT start until ALL are true

- [ ] **Frozen build** deployed to a dedicated UAT environment (see `UAT-ENVIRONMENT-SETUP.md`). No hotfixes to that environment mid-cycle except approved defect fixes.
- [ ] **Test accounts provisioned** for every role in scope (Section 5), on seeded, non-production, clearly-fake resident data.
- [ ] **Data-security controls reviewed** and signed off (see `PHI-SECURITY-REVIEW.md`) — access scoping, audit logging, encryption at rest, backups.
- [ ] **Internal smoke pass** — dev has walked the full happy-path flow once on the UAT build and it completes without error.
- [ ] **Defect log** (spreadsheet or issue tracker) set up with the severity scale in Section 7.

## 3. Exit / sign-off criteria — UAT is "passed" when

- [ ] All **Critical** and **High** scenarios pass.
- [ ] Zero open **Blocker/Critical** defects. High defects have an agreed fix or accepted-risk sign-off.
- [ ] Each role owner signs off on their scenarios (Section 8).
- [ ] Assessment → LOC → Care Plan produces the **same output for the same inputs** across at least 3 distinct resident profiles (governed-engine determinism check).

---

## 4. Test environment & data

| Item | Requirement |
|------|-------------|
| Environment | Dedicated UAT/staging, separate DB from production |
| Data | Seeded synthetic residents only — **no real PHI in UAT** |
| Build | Single frozen commit SHA, recorded in the defect log header |
| Reset | Ability to re-seed to a known state between test runs |

---

## 5. Roles under test & accounts

| Role | Primary responsibility in the flow | Test account |
|------|-----------------------------------|--------------|
| CRM | Lead → refer into pipeline | `crm@…` |
| Admissions / Intake | Create admission, capture pre-admission data | `admissions@…` |
| Nurse | Run assessment, **approve** care plan, clinical docs | `nurse@…` |
| Care Manager | Clinical oversight, approvals, LOC review | `cm@…` |
| Caregiver | Execute care tasks from routine, document | `caregiver@…` |
| Family / Sponsor | Read-only clinical records, timeline, invoices | `family@…` |
| Billing Admin | LOC-based billing posted on approval | `billing@…` |

---

## 6. Test scenarios

Each scenario: **Steps → Expected result → Pass/Fail**. Testers record actual result + defect ID if failed.

### 6.1 CRITICAL — Core end-to-end clinical flow

| # | Step | Expected result | P/F |
|---|------|-----------------|-----|
| E1 | Admissions creates a new admission and completes pre-admission | Resident record created; pre-admission data persists on refresh | |
| E2 | Nurse opens the LifeCare **14-domain assessment** for that resident and submits scores | Assessment saves; a **Level of Care (1–5)** is computed by the rule engine and displayed | |
| E3 | Confirm the LOC is **derived from the governed rules**, not free-typed | Same domain scores → same LOC. Re-open shows identical result | |
| E4 | System generates the **Care Plan** from the approved LOC | Care plan draft appears with interventions matched to the LOC | |
| E5 | Nurse **reviews and approves** the care plan | Plan cannot become active without nurse approval; approval is recorded (who/when) | |
| E6 | Care plan translates to the **24-hour resident routine** | Routine populated with time-blocked tasks consistent with the plan | |
| E7 | Routine surfaces on the **Caregiver dashboard** as shift-scoped care tasks | Caregiver sees only their residents' tasks for the current shift | |
| E8 | Caregiver marks tasks done / documents | Documentation saves and is visible to nurse/CM | |
| E9 | Re-run E1–E7 for **2 more resident profiles** with different acuity | LOC and plan differ appropriately and remain deterministic | |

### 6.2 HIGH — Access control & data scoping (per role)

| # | Step | Expected result | P/F |
|---|------|-----------------|-----|
| A1 | Caregiver logs in | Sees ONLY assigned residents / own-shift tasks; no admin or cross-community data | |
| A2 | Nurse from Community X | Cannot see residents/alerts from Community Y | |
| A3 | Family/Sponsor logs in | Read-only, scoped to their resident only; no edit controls | |
| A4 | Each role's sidebar | Only role-permitted tabs are present and functional | |
| A5 | Direct-URL attempt to another role's route | Access denied / redirected (not silently served) | |

### 6.3 HIGH — Audit & record integrity

| # | Step | Expected result | P/F |
|---|------|-----------------|-----|
| I1 | Nurse edits a clinical record | An audit entry captures who / what / when | |
| I2 | Sign a record with PIN | Record locks; PIN required; lock prevents further edit/delete | |
| I3 | Attempt to edit a signed/locked record | Blocked | |

### 6.4 MEDIUM — Supporting dashboards (Care360, per role)

One row per role: log in, exercise the 2–3 primary daily actions, confirm data reads/writes correctly and stays scoped. (Nurse: MAR, vitals, endorsements. CM: acuity/care-plan reviews, approvals. Caregiver: task board, daily rounds. Billing: LOC charge posted on approval.)

---

## 7. Defect severity & logging

| Severity | Definition | UAT impact |
|----------|------------|-----------|
| Blocker | Flow cannot proceed; data loss; PHI exposure | Stops UAT |
| Critical | Core clinical output wrong (e.g., wrong LOC/plan) | Must fix before sign-off |
| High | Major function broken, workaround exists | Fix or accept-risk before sign-off |
| Medium | Minor function / UX | Track, fix post-UAT ok |
| Low | Cosmetic | Backlog |

Each defect logs: build SHA, role, steps to reproduce, expected vs actual, severity, screenshot.

---

## 8. Sign-off

| Role | Name | Scenarios | Result | Date |
|------|------|-----------|--------|------|
| Nurse | | E-series, I-series | | |
| Care Manager | | E-series, 6.4 | | |
| Caregiver | | E7–E8, A1 | | |
| Billing | | 6.4 | | |
| Clinical lead | Myla Reyes | Overall | | |
| Dev | MJ Manalo | Environment + defects closed | | |

---

*This plan validates workflow correctness and access safety. It is not a substitute for a formal security/compliance certification; the PHI security review (`PHI-SECURITY-REVIEW.md`) documents current technical controls and gaps separately.*
