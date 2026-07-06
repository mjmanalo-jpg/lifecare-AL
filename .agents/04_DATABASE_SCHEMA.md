# 04 DATABASE SCHEMA

## Data Models
- **Users/Roles:** Extending Supabase Auth for Admins, Nurses, Families, Residents.
- **Resident Profile:** Demographics, Care Level, Room Assignment.
- **EHR Logs:** Vitals (Time-Series), Medication schedules (eMAR), incident reports.
- **Billing:** Invoices, payments, a la carte services.

## Relations
- `Resident` 1:N `Family Sponsor`
- `Resident` 1:N `Vitals Logs`
- `Nurse` 1:N `Shift Assignments`

## Indexing Strategies
- B-Tree indexes on lookup keys (User IDs, Resident IDs).
- Time-series optimized indexing for high-frequency vital logs and anomaly events.

## ORM Setup
- **Prisma Schema:** Acts as the single source of truth for the Database.
- Migrations managed strictly via `npx prisma migrate dev`.
