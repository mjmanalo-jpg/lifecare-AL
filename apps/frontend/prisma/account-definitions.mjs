// Seeded LifeCare credential accounts — single source of truth, no side effects.
// Imported by seed-auth.mjs (account seeding) and backfill-ph-phones.mjs.
//
// Mobile numbers are real PH 11-digit lines (09XX XXX XXXX). They are the login
// key for the huma-style company + mobile sign-in, so each must be unique.
export const ACCOUNT_DEFINITIONS = [
  { email: process.env.SAMPLE_PLATFORM_ADMIN_EMAIL || "platform.admin@lifecarecms.test", password: process.env.SAMPLE_PLATFORM_ADMIN_PASSWORD, name: "Sample Platform Administrator", role: "SUPERADMIN", platformRole: "PLATFORM_ADMIN", firstName: "Sample", lastName: "Administrator" },
  { email: "superadmin@lifecare.com", name: "System Admin", role: "SUPERADMIN", phone: "09171000001", firstName: "System", lastName: "Admin" },
  // Facility Admin → the Facility Management portal. org role VIEWER keeps it out
  // of the Organization Admin portal; the community role drives the login.
  { email: "facilityadmin@lifecare.com", name: "LifeCare Facility Management", role: "FACILITY_ADMIN", phone: "09171000002", firstName: "Facility", lastName: "Management", orgRole: "VIEWER" },
  // Billing & Finance → the dedicated billing portal. org role VIEWER keeps it
  // out of the Organization Admin portal; the community role drives the login.
  { email: "billing@lifecare.com", name: "LifeCare Billing & Finance", role: "BILLING_ADMIN", phone: "09171000003", firstName: "Billing", lastName: "Finance", orgRole: "VIEWER" },
  // Dedicated Organization Admin login (SaaS tenant-management portal).
  { email: "orgadmin@lifecare.com", name: "LifeCare Organization Admin", role: "FACILITY_ADMIN", phone: "09171000004", firstName: "Organization", lastName: "Admin", orgRole: "ADMIN" },
  // Care Manager → the clinical-oversight portal (approvals, incidents, alerts,
  // rounds, MAR, consent forms). Community-scoped clinical role, no org role.
  { email: "caremanager@lifecare.com", name: "LifeCare Care Manager", role: "CARE_MANAGER", phone: "09171000005", firstName: "Care", lastName: "Manager" },
  { email: "residentcoordinator@lifecare.com", name: "LifeCare Resident Coordinator", role: "RESIDENT_COORDINATOR", phone: "09171000033", firstName: "Resident", lastName: "Coordinator" },
  { email: "physician@lifecare.com", name: "Dr. Alan Reyes", role: "PHYSICIAN", phone: "09171000006", firstName: "Alan", lastName: "Reyes" },
  { email: "nurse@lifecare.com", name: "Sarah Jenkins", role: "NURSE", phone: "09171000007", firstName: "Sarah", lastName: "Jenkins" },
  { email: "nurse2@lifecare.com", name: "Rebecca Wilson", role: "NURSE", phone: "09171000008", firstName: "Rebecca", lastName: "Wilson" },
  { email: "caregiver@lifecare.com", name: "Caleb Randall", role: "CAREGIVER", phone: "09171000009", firstName: "Caleb", lastName: "Randall" },
  { email: "caregiver2@lifecare.com", name: "James Mitchell", role: "CAREGIVER", phone: "09171000010", firstName: "James", lastName: "Mitchell", approved: false },
  { email: "caregiver3@lifecare.com", name: "Maria Santos", role: "CAREGIVER", phone: "09171000011", firstName: "Maria", lastName: "Santos", active: false, approved: false },
  { email: "family@lifecare.com", name: "John Pendelton", role: "FAMILY", phone: "09171000012", firstName: "John", lastName: "Pendelton" },
  { email: "resident@lifecare.com", name: "Arthur Pendelton", role: "RESIDENT", phone: "09171000013", firstName: "Arthur", lastName: "Pendelton" },
  { email: "fleet@lifecare.com", name: "Marcus Dela Cruz", role: "FLEET_MANAGEMENT", phone: "09171000014", firstName: "Marcus", lastName: "Dela Cruz" },
  { email: "driver@lifecare.com", name: "James Miguel", role: "DRIVER", phone: "09171000015", firstName: "James", lastName: "Miguel" },
  { email: "security@lifecare.com", name: "Ramon Bautista", role: "SECURITY", phone: "09171000016", firstName: "Ramon", lastName: "Bautista" },
];
