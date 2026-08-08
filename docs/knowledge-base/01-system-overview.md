# SLMS / LifeCare CMS — System Overview

## What this system is
The Senior Living Management System (SLMS), also branded LifeCare CMS, is the all-in-one platform that runs Golden Hearth Assisted Living. It brings clinical care, facility operations, and administration into one place so staff, residents, and families work from the same source of truth.

## The three domains
1. **Clinical & Care** — resident health: daily rounds, medication administration (MAR), assessments and level-of-care (acuity), care plans, incidents, escalations, follow-ups, physician coordination, and clinical alerts.
2. **Operations & Hospitality** — the day-to-day running of the community: admissions, staffing, inventory and materials, hospitality/hotel-style services, dining, events, transport/fleet, maintenance, and housekeeping.
3. **Administration & Billing** — governance and money: full-system oversight, approvals, audit, staff registries, billing and finance, statements, and payments.

## Who uses it
The system is multi-tenant and role-based. Each staff role signs into a dedicated portal that shows only what that role needs. Residents and family members have their own portals. See "Roles and Portals" for the full breakdown.

## How the AI Assistant fits in
The AI Assistant (named "Sunny" by default) is grounded in this knowledge base. Residents can ask about their schedule, meals, activities, or vitals; staff can ask how to use the system or about facility policies. The assistant answers from the documents loaded here, so keeping this knowledge base accurate keeps the assistant accurate.

## Facility identity
- **Community:** Golden Hearth Assisted Living
- **Organization:** Golden Hearth Care Group
- **Currency:** Philippine Peso (₱) is used system-wide for all billing and pricing.

## Key principles
- **One source of truth** — data entered once (a vital, a task, a note) reflects everywhere it is relevant, including resident profiles and QR cards.
- **Live data** — dashboards update in real time as records change.
- **Tenant isolation** — each community's data is walled off from every other community by database-level row-level security.
- **Evidence and audit** — significant actions are recorded in the audit log for compliance.
