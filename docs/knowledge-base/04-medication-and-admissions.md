# Medication Management & Admissions

## Medication management
- **Medication orders** are created for residents and enter an approval queue.
- **Medication Approvals** — physicians (and the Administrator/Care Manager) review and approve pending orders before they become active. This is the "Medication Approvals" workflow in the Medication section of the sidebar.
- **MAR (Medication Administration Record)** — nurses record each administration against the resident's active medications. Administrations appear in the audit log and in clinical activity views.
- Controlled steps can be signed and locked with the staff member's signing PIN (see "Security & Audit").

## Admissions & Resident Registration
New residents are enrolled through a multi-step registration wizard:
1. Account details (email + password) and personal information.
2. **Facial enrollment** — four face poses are captured to enroll the resident for camera-based recognition/monitoring.
3. Diagnosis and clinical intake information.
4. An **intake body-check** documents the resident's condition on arrival (a body-map of findings).

On registration the system creates the resident's User account, Resident profile, and face-enrollment documents, and hashes the account password.

### Patient ID and QR card
Each resident gets a derived **Patient ID**. A Module-01 profile QR card is generated for the resident; the Patient ID and key profile details appear on the printable QR PDF so staff can identify residents quickly at the bedside.

### Resident profile
The resident profile stores diagnosis, care level, active call bells, open incidents, medications, and documentation. Task notes added by staff reflect onto the resident profile and the QR-linked view so the whole care team sees the same information.
