import { prisma } from "./prisma";
import type { SessionData } from "./auth";

/**
 * Data-access scoping for self-service roles (FAMILY, RESIDENT).
 *
 * Staff roles (SUPERADMIN/FACILITY_ADMIN/PHYSICIAN/NURSE/CAREGIVER) see the
 * whole facility and are never scoped here. Self-service roles must only read
 * data belonging to their own resident(s):
 *   - FAMILY   → the resident(s) they sponsor (`Resident.sponsorId = userId`)
 *   - RESIDENT → their own linked record       (`Resident.userId   = userId`)
 *
 * `scopeWhere` returns an extra Prisma `where` clause to AND into a list query,
 * or `null` when no scoping applies. The `"__none__"` sentinel is an id that can
 * never exist, so a denied/empty scope yields zero rows instead of leaking data.
 */

// Models that hang off a Resident via `residentId`.
const RESIDENT_SCOPED = new Set([
  "vitals",
  "incidents",
  "medications",
  "tasks",
  "invoices",
  "visits",
  "resident-notes",
  "medical-notes",
  "call-bells",
  "service-charges",
  "insurance-validations",
  // Fleet & transport — family/resident may follow their own requests & trips.
  "transport-requests",
  "trips",
  "dietitian-consults",
]);

const DENY: Record<string, unknown> = { id: "__none__" };

/** Resident ids a FAMILY sponsor may see. */
async function sponsoredResidentIds(userId: string): Promise<string[]> {
  const rows = await prisma.resident.findMany({ where: { sponsorId: userId }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** The single resident id a RESIDENT login maps to (their own record). */
async function selfResidentId(userId: string): Promise<string | null> {
  const row = await prisma.resident.findFirst({ where: { userId }, select: { id: true } });
  return row?.id ?? null;
}

export async function scopeWhere(
  modelKey: string,
  session: SessionData
): Promise<Record<string, unknown> | null> {
  const uid = session.userId;

  if (session.role === "FAMILY" && uid) {
    // Global app settings (assistant voice/personality…) are shared, non-sensitive
    // config every portal reads live; writes remain staff-only via POST rules.
    if (modelKey === "app-settings") return null;
    if (modelKey === "residents") return { sponsorId: uid };
    if (RESIDENT_SCOPED.has(modelKey)) {
      const ids = await sponsoredResidentIds(uid);
      return { residentId: { in: ids.length ? ids : ["__none__"] } };
    }
    if (modelKey === "payments") {
      const ids = await sponsoredResidentIds(uid);
      return { invoice: { residentId: { in: ids.length ? ids : ["__none__"] } } };
    }
    if (modelKey === "messages") return { OR: [{ senderId: uid }, { recipientId: uid }] };
    if (modelKey === "notifications") return { userId: uid };
    return DENY;
  }

  if (session.role === "RESIDENT" && uid) {
    if (modelKey === "app-settings") return null;
    if (modelKey === "residents") return { userId: uid };
    if (RESIDENT_SCOPED.has(modelKey)) {
      const id = await selfResidentId(uid);
      return { residentId: id ?? "__none__" };
    }
    if (modelKey === "payments") {
      const id = await selfResidentId(uid);
      return { invoice: { residentId: id ?? "__none__" } };
    }
    if (modelKey === "messages") return { OR: [{ senderId: uid }, { recipientId: uid }] };
    if (modelKey === "notifications") return { userId: uid };
    return DENY;
  }

  return null; // staff roles — unscoped
}

// ── Demo-mode scoping ─────────────────────────────────────────────────────────
// In demo mode there is no DB to resolve a userId, so self-service logins are
// pinned to the demo relative "Arthur Pendelton" (resident id "r1", Room 302) so
// the FAMILY/RESIDENT data boundary is still demonstrable offline. Staff see all.
const DEMO_RESIDENT_ID = "r1";
const DEMO_ROOM = "302";

type Row = Record<string, unknown>;

function belongsToDemoResident(row: Row): boolean {
  if (row.residentId === DEMO_RESIDENT_ID) return true;
  const inv = row.invoice as { residentId?: string } | undefined;
  if (inv?.residentId === DEMO_RESIDENT_ID) return true;
  const res = row.resident as { roomNumber?: string } | undefined;
  return res?.roomNumber === DEMO_ROOM;
}

function getDemoNotificationsForRole(role: string): Row[] {
  const baseDate = new Date();
  const iso = (msOffset: number) => new Date(baseDate.getTime() - msOffset).toISOString();
  
  const H = 60 * 60 * 1000;
  const D = 24 * H;

  switch (role) {
    case "SUPERADMIN":
      return [
        { id: "sa_n1", type: "SYSTEM_ALERT", title: "System Health Optimal", message: "All microservices and database engines responding at optimal speed (45ms).", isRead: false, createdAt: iso(10 * 1000) },
        { id: "sa_n2", type: "SYSTEM_ALERT", title: "Supabase Connection Healthy", message: "Realtime subscription pool contains 8 active channels.", isRead: false, createdAt: iso(12 * H) },
        { id: "sa_n3", type: "CALL_BELL", title: "Emergency System Checked", message: "Successfully verified emergency call bell route and response protocols.", isRead: true, createdAt: iso(1 * D) },
      ];
    case "FACILITY_ADMIN":
      return [
        { id: "fa_n1", type: "SYSTEM_ALERT", title: "Admissions Verification Pending", message: "Dorothy Hale is waiting for room allocation to complete step 8.", isRead: false, createdAt: iso(5 * 1000) },
        { id: "fa_n2", type: "INCIDENT_REPORT", title: "Incident Logged", message: "Caregiver Caleb Randall logged a call bell response event in Room 305.", isRead: false, createdAt: iso(2 * H) },
        { id: "fa_n3", type: "TASK_ASSIGNMENT", title: "Staff Shift Roster", message: "12 active care professionals have successfully clocked in for today's shifts.", isRead: true, createdAt: iso(18 * H) },
      ];
    case "PHYSICIAN":
      return [
        { id: "ph_n1", type: "VITAL_ALERT", title: "Arthur Pendelton Vitals Alert", message: "Arthur's Heart Rate spiked to 104 bpm during therapy. Vitals now stable.", isRead: false, createdAt: iso(15 * 1000) },
        { id: "ph_n2", type: "MEDICATION_REMINDER", title: "Medication Warning", message: "Frank Osei (Room 312) medication overdue by 2 hours.", isRead: false, createdAt: iso(3 * H) },
        { id: "ph_n3", type: "MESSAGE", title: "New Handover Note", message: "Sarah Jenkins, RN submitted clinical handover reports.", isRead: true, createdAt: iso(6 * H) },
      ];
    case "NURSE":
      return [
        { id: "nu_n1", type: "CALL_BELL", title: "Emergency Call Bell: Room 302", message: "Arthur Pendelton triggered the room call bell. Assistance needed.", isRead: false, createdAt: iso(8 * 1000) },
        { id: "nu_n2", type: "VITAL_ALERT", title: "Arthur SpO2 Dropped", message: "Oxygen saturation level dipped below 95% temporarily.", isRead: false, createdAt: iso(1.5 * H) },
        { id: "nu_n3", type: "INCIDENT_REPORT", title: "Fall Heuristics Alert", message: "Room 305 vision feed triggered a potential balance loss warning.", isRead: true, createdAt: iso(4 * H) },
      ];
    case "CAREGIVER":
      return [
        { id: "ca_n1", type: "CALL_BELL", title: "Call Bell: Room 302 Assistance", message: "Help requested with repositioning and physical comfort checks.", isRead: false, createdAt: iso(3 * 1000) },
        { id: "ca_n2", type: "TASK_ASSIGNMENT", title: "Checklist Pending", message: "3 morning wellness and dietary tasks remain incomplete.", isRead: false, createdAt: iso(1 * H) },
        { id: "ca_n3", type: "SHIFT_REMINDER", title: "Clock-In Reminder", message: "Afternoon shift starts in 30 minutes. Please prepare for shift handover.", isRead: true, createdAt: iso(3 * H) },
      ];
    case "FAMILY":
      return [
        { id: "fm_n1", type: "VITAL_ALERT", title: "Relative Vitals Stable", message: "Arthur Pendelton's morning vitals registered healthy (BP 120/80).", isRead: false, createdAt: iso(20 * 1000) },
        { id: "fm_n2", type: "MEDICATION_REMINDER", title: "Medications Administered", message: "Head Nurse Sarah Jenkins successfully administered daily blood pressure pills.", isRead: false, createdAt: iso(2 * H) },
        { id: "fm_n3", type: "MESSAGE", title: "Daily Comfort Report", message: "Caleb Randall reports Arthur slept comfortably and participated in social games.", isRead: true, createdAt: iso(5 * H) },
      ];
    case "FLEET_MANAGEMENT":
      return [
        { id: "fl_n1", type: "TRANSPORT_UPDATE", title: "New Transport Request", message: "Arthur Pendelton requested a dialysis run for tomorrow 8:00 AM — pending dispatcher review.", isRead: false, createdAt: iso(12 * 1000) },
        { id: "fl_n2", type: "SYSTEM_ALERT", title: "Registration Expiring", message: "Wheelchair Van WV-001 registration expires in 14 days. Renew to stay compliant.", isRead: false, createdAt: iso(3 * H) },
        { id: "fl_n3", type: "TASK_ASSIGNMENT", title: "Preventive Maintenance Due", message: "Shuttle SH-001 hits its 5,000 km service interval this week.", isRead: true, createdAt: iso(1 * D) },
      ];
    case "RESIDENT":
      return [
        { id: "re_n1", type: "TASK_ASSIGNMENT", title: "Physical Therapy Scheduled", message: "Your PT session with Caleb is scheduled for 2:00 PM today.", isRead: false, createdAt: iso(30 * 1000) },
        { id: "re_n2", type: "MEDICATION_REMINDER", title: "Medications Reminder", message: "Afternoon pills are scheduled in 15 minutes.", isRead: false, createdAt: iso(45 * 1000) },
        { id: "re_n3", type: "MESSAGE", title: "New Message from Sponsor", message: "John Pendelton shared a photo and message with your care dashboard.", isRead: true, createdAt: iso(8 * H) },
      ];
    default:
      return [
        { id: "def_n1", type: "SYSTEM_ALERT", title: "Welcome to Golden Hearth", message: "Logged in successfully to your portal workspace.", isRead: false, createdAt: iso(1 * H) }
      ];
  }
}

export function scopeDemoRows(modelKey: string, rows: Row[], role: string, userId?: string): Row[] {
  if (modelKey === "notifications") {
    // Use actual demo notifications filtered by userId for staff, or role-based for self-service
    // (FLEET_MANAGEMENT also gets role-specific demo notifications for a populated bell).
    if (role === "FAMILY" || role === "RESIDENT" || role === "FLEET_MANAGEMENT")
      return getDemoNotificationsForRole(role);
    return userId ? rows.filter((n) => (n as { userId?: string }).userId === userId) : rows;
  }
  if (modelKey === "app-settings") return rows; // global config — visible to all roles
  if (role !== "FAMILY" && role !== "RESIDENT") return rows;
  if (modelKey === "residents") return rows.filter((r) => r.id === DEMO_RESIDENT_ID);
  if (RESIDENT_SCOPED.has(modelKey) || modelKey === "payments") return rows.filter(belongsToDemoResident);
  if (modelKey === "messages") return rows; // illustrative in demo
  // Staff-only collections are hidden from self-service roles.
  return [];
}

