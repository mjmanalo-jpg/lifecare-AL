# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The product is B2B2C. Its users fall in three tiers, all inside one senior-living ("home for the aged") operation:

- **Operational & clinical staff** — the primary daily users. 18 role-scoped portals, including Physician, Nurse (head/charge), Caregiver, Care Manager (clinical oversight), Facility Admin (operations), Billing & Finance, Nutritionist, Kitchen, Housekeeping, Maintenance, Security, Fleet Manager, and Driver. They work in shifts, at the bedside, on the move, and at a desk — often on shared or older devices, sometimes gloved, frequently interrupted.
- **Platform & tenant governance** — Platform Admin (provisions and governs customer organizations, plans, subscriptions) and Organization Admin (manages a company's communities, people, access, branding, billing).
- **Residents and their families** — Residents (self-service "My Care" view) and Family Sponsors, who are frequently **overseas** and depend on the family portal for transparency into a relative's daily care, vitals, appointments, and billing from a distance.

## Product Purpose

A senior-living **care operating system**: it runs an assisted-living operation end to end — clinical care, daily operations, hospitality, transport, billing, and family transparency — on one shared record. Its distinctive spine is a continuous **care-intelligence loop**: a structured multi-dimension assessment produces an acuity score, which derives a level of care, which selects a care package, which auto-generates the daily task and documentation schedule, which feeds quality scorecards, which trigger reassessment. Success is safer residents, less-blind families, clinically rigorous and auditable operations, and staff who spend less time on paperwork and coordination.

## Positioning

Bridges **world-class clinical operations (German-standard clinical rigor)** with **deep Edge-AI elder safety** (voice copilot / voice charting, camera-based fall and sleep detection, an always-on server-side fall watchdog) and **total transparency for overseas families**. A neighboring operations-only or EHR-only product could not truthfully claim the same combination: an explainable, configurable acuity engine driving staffing and care, real-time on-device safety AI, and a family portal built for relatives watching from another country — all in one multi-tenant system.

## Operating Context

- **Multi-tenant SaaS**, sold to senior-living operators. The live hierarchy is Organization → Community (facility) → Building → Floor → Unit → Room → Resident; nearly all data is community-scoped, and tenant isolation is a first-class concern.
- Shift-based clinical work: bedside documentation, medication administration (MAR), rounds, endorsements/handoffs at shift change, SBAR escalations, call bells.
- Real usage spans a clinical floor, an operations back office, a kitchen, a security post, vehicles in transit, and residents' rooms — plus family members reading remotely across time zones.
- Rituals the product must respect: signing and locking clinical records (PIN-gated e-signature), audit trails on sensitive actions, approval workflows, and continuity between outgoing and incoming shifts.

## Capabilities and Constraints

**Confirmed capability domains (built and live):**
- Resident profile & unified care record; admissions/registration (multi-step wizard with facial enrollment) and CRM lead pipeline.
- Assessment & acuity / level-of-care; care planning and care-plan reviews; pre-admission (LifeCare Stage-2) scored assessment.
- Daily care documentation & monitoring: care logs, ADL monitoring, weight monitoring, vitals trends, wound care, shift summaries, daily rounds.
- Shift endorsement & continuity; task assignment (workers see only their own current-shift tasks).
- Medication management: MAR, medication compliance, medication & supply inventory (FEFO, barcode scanning, purchase requests).
- Clinical coordination: SBAR escalation, physician comms log, referrals & appointments, clinical records hub, resident progress reports, appointment calendar (with ICS/Google export).
- Reporting & care intelligence dashboards; alerts & automation; quality monitoring.
- Fleet & transport (requests, trips, vehicles, drivers, inspections, fuel, live GPS) and a driver portal.
- Hospitality / PMS: front desk, room turnover, concierge, dining & diet orders, community events, service & maintenance requests.
- Billing & finance: charge library, invoicing, receivables/aging, revenue, insurance validation, receipts, statements, GL export; online payment is built but **gated off** pending an approved payment provider.
- Edge AI: camera fall/sleep detection, voice copilot / voice charting, admin AI assistant with a knowledge base; an always-on server-side fall watchdog independent of login.
- Governance: 18-role RBAC with per-role sidebar scoping and a feature/portal matrix; audit logging; PIN-gated signing that locks records.

**Constraints and terminology:**
- Architecture: a Next.js (App Router) frontend + a Python FastAPI backend + Supabase (PostgreSQL) with Prisma ORM. (Recorded as context, not a design instruction.)
- Live data flows through a generic `/api/db/[model]` layer plus `useLiveQuery` (Supabase realtime with a polling fallback); this generic layer whitelists fields and can silently swallow non-whitelisted writes.
- A meaningful amount of newer functionality is deliberately **migration-free** — persisted as JSON in `app-settings` rather than new Prisma columns — because schema migrations mid-session are constrained in this environment.
- Domain vocabulary is clinical and operational: acuity, level of care, care package, MAR, SBAR, endorsement, ADL, FEFO, resident vs. patient, community vs. organization.

**Explicitly undecided / open:**
- **Product brand name is not fixed.** Docs variously say "SLMS," "LCMS / LifeCare CMS," and "LCOS"; the product is effectively white-label and "Golden Hearth Senior Living" is demo seed data only, not the brand. Future work must not treat any of these as the committed product name.
- Several LCMS-spec features remain planned/partial (e.g. structured elimination/pain tracking, staff scheduling, PDF report export, external lab/pharmacy/EHR integration).

## Brand Commitments

- No committed product name or logo yet (see open decisions above). Do not invent one.
- Tenant/organization **branding is a product feature** (Organization Branding, Landing Studio): the visual identity is expected to be themeable per customer rather than a single fixed brand.
- The app ships a dark-by-default theme with a light toggle, and an existing "clinical-editorial" design language (sage / teal / coral) drawn from the product's own feature-overview material. These are the incumbent visual system, to be recorded by `document`, not re-decided here.

## Evidence on Hand

- Real, substantial product documentation: `.agents/00_GLOBAL_BLUEPRINT.md`, `docs/LIFECARE-CMS-V2.1-ARCHITECTURE.md` (full architecture, ERD, API specs, workflows, wireframes), `docs/LCMS-FEATURE-MATRIX.md` (feature-by-feature implemented/partial/missing status), and `docs/SAAS-OPERATIONS.md`.
- A large working codebase: 18 role portals, a generic live-data layer, a FastAPI backend, and demo seed accounts/community.
- **No real resident, staff, or financial data and no customer testimonials or benchmarks exist** — all current names, communities, and figures ("Golden Hearth," seed users, sample metrics) are demonstration data. Future work must not present them as real customers, outcomes, or proof.

## Product Principles

1. **The care-intelligence loop is the spine.** Assessment → acuity → level of care → care package → tasks/documentation → quality → reassessment is the through-line; features earn their place by feeding or acting on it.
2. **Clinically rigorous and auditable.** Explainable acuity, signed-and-locked records, audit trails, and shift continuity are non-negotiable; the system is a system of record, not a toy.
3. **Safety is proactive and always-on.** Edge AI (fall/sleep detection, voice charting, server-side watchdog) exists to catch what humans on a shift can miss.
4. **Transparency across distance.** Families — often overseas — are first-class users owed a clear, trustworthy window into their relative's care.
5. **Multi-tenant by default.** Every design decision assumes community-scoped data and per-tenant branding, never a single hard-coded facility.

## Accessibility & Inclusion

- Users skew older (residents) and span a very wide range of digital comfort and device quality; clarity, legibility, and forgiving interactions outrank density and cleverness.
- Frontline clinical use happens under interruption, time pressure, and sometimes poor conditions (gloves, glare, shared devices), so touch targets, contrast, and error tolerance matter operationally.
- No specific formal accessibility standard (e.g. a named WCAG conformance level) has been established as a binding requirement yet.
