# Family Portal, Consent Forms, Security & Audit

## Consent & Move-in Forms
The Care Manager configures consent and move-in forms. Forms/PDFs are viewable, and families can review, e-sign, and upload documents from the family portal. On the family portal the internal "documents on file" list is hidden — families see only what is relevant to them (forms to sign and their own uploads).

## Family & Resident portals
- Families see their resident's status and a shared appointment calendar.
- Residents get a personal dashboard (schedule, meals, vitals, documents, appointments) plus the AI companion.
- Document e-signing uses a signature capture flow.

## Signing PIN (sign & lock)
Each staff member has an auto-generated **4-digit signing PIN**, created when their account is made and viewable in their Settings. Entering the PIN signs and locks a record (for example a shift endorsement/report), after which it cannot be edited or deleted except for allowed follow-up fields. PIN hashes are stored encrypted and never exposed to the client.

## Audit Log
- **Administrator audit log** records **all transactions** happening in the system — creates, updates, deletes, logins, and exports across every entity.
- **Care Manager audit log** ("Care Activity Log") is scoped to **clinical activity** — task completions, medication administration (MAR), daily rounds, assessments, incidents, referrals, and other care events — shown in plain language.
- Every create/update/delete through the system's data layer is recorded automatically, along with who did it and when.

## Data security & tenant isolation
- Each community's data is isolated by database row-level security (RLS); users only see data for communities they belong to.
- Passwords and PINs are hashed/encrypted.
- Authentication is handled through Supabase Auth; the app issues a signed session that carries the user's role and active community.
