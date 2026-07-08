/**
 * Demo dataset served by /api/db and /api/stats when the database is not yet
 * configured (DATABASE_URL still a placeholder). Rows are shaped exactly like
 * Prisma rows — including nested `resident`/`user` relations — so the adapters
 * and portals render identically whether data is live or demo. The moment real
 * credentials are set, the routes bypass this entirely and query Supabase.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const H = 3600 * 1000;
const D = 24 * H;

const residentsBase = [
  { id: "r1", firstName: "Arthur", lastName: "Pendelton", roomNumber: "302", careLevel: "ASSISTED", dateOfBirth: iso(78 * 365 * D), allergies: "Penicillin, Sulfa drugs", medicalHistory: "Hypertension, Type 2 Diabetes", notes: "Stable condition. Regular monitoring." },
  { id: "r2", firstName: "Eleanor", lastName: "Fitzroy", roomNumber: "305", careLevel: "MEMORY", dateOfBirth: iso(85 * 365 * D), allergies: "None known", medicalHistory: "Alzheimer's, Arthritis", notes: "Memory decline noted. Increase supervision." },
  { id: "r3", firstName: "Robert", lastName: "Chen", roomNumber: "310", careLevel: "INDEPENDENT", dateOfBirth: iso(72 * 365 * D), allergies: "None known", medicalHistory: "High Cholesterol", notes: "Self-sufficient." },
  { id: "r4", firstName: "Margaret", lastName: "Wilson", roomNumber: "312", careLevel: "SKILLED", dateOfBirth: iso(80 * 365 * D), allergies: "Codeine", medicalHistory: "Atrial Fibrillation, Heart Failure", notes: "BP elevated. Monitor closely." },
  { id: "r5", firstName: "James", lastName: "Murphy", roomNumber: "308", careLevel: "ASSISTED", dateOfBirth: iso(76 * 365 * D), allergies: "None known", medicalHistory: "Post-Surgery Recovery", notes: "Recovering well; PT progressing." },
];

const residentRef = (r: any) => ({ firstName: r.firstName, lastName: r.lastName, roomNumber: r.roomNumber });

const incidents = [
  { id: "i1", incidentType: "FALL", severity: "CRITICAL", description: "Unsteady gait during ambulation; resident nearly fell.", incidentDate: iso(1 * H), resolvedAt: null, immediateActions: "Assigned mobility assistance.", resident: residentRef(residentsBase[1]) },
  { id: "i2", incidentType: "MEDICATION_ERROR", severity: "SEVERE", description: "Wrong dosage administered.", incidentDate: iso(4 * H), resolvedAt: null, followUpNotes: "Physician notified. Monitoring vitals.", resident: residentRef(residentsBase[0]) },
  { id: "i3", incidentType: "INFECTION", severity: "CRITICAL", description: "Signs of urinary tract infection.", incidentDate: iso(12 * H), resolvedAt: null, immediateActions: "Lab culture sent; started antibiotics.", resident: residentRef(residentsBase[3]) },
  { id: "i4", incidentType: "OTHER", severity: "MODERATE", description: "Blood pressure spike to 165/95.", incidentDate: iso(1 * D), resolvedAt: iso(20 * H), resident: residentRef(residentsBase[2]) },
];

const medications = [
  { id: "m1", name: "Lisinopril", dosage: "10mg", frequency: "Daily", status: "ACTIVE", startDate: iso(300 * D), residentId: "r1" },
  { id: "m2", name: "Metformin", dosage: "500mg", frequency: "Twice daily", status: "ACTIVE", startDate: iso(300 * D), residentId: "r1" },
  { id: "m3", name: "Donepezil", dosage: "5mg", frequency: "Daily", status: "ACTIVE", startDate: iso(400 * D), residentId: "r2" },
  { id: "m4", name: "Warfarin", dosage: "5mg", frequency: "Daily", status: "ACTIVE", startDate: iso(120 * D), residentId: "r4" },
];

const residents = residentsBase.map((r) => ({
  ...r,
  incidents: incidents.filter((i) => i.resident.roomNumber === r.roomNumber && !i.resolvedAt),
  medications: medications.filter((m) => m.residentId === r.id),
}));

const staff = [
  { id: "s1", position: "Head Nurse", department: "Clinical Care", isActive: true, hireDate: iso(1200 * D), userId: "u2", user: { name: "Sarah Jenkins", email: "sarah.jenkins@goldenhearth.com", phone: "555-0101" } },
  { id: "s2", position: "RN - Supervisor", department: "Clinical Care", isActive: true, hireDate: iso(1800 * D), userId: "u3", user: { name: "Rebecca Wilson", email: "rebecca.wilson@goldenhearth.com", phone: "555-0105" } },
  { id: "s3", position: "Caregiver", department: "Daily Assistance", isActive: true, hireDate: iso(560 * D), userId: "u4", user: { name: "Caleb Randall", email: "caleb.randall@goldenhearth.com", phone: "555-0102" } },
  { id: "s4", position: "Caregiver", department: "Daily Assistance", isActive: true, hireDate: iso(300 * D), userId: "u5", user: { name: "James Mitchell", email: "james.mitchell@goldenhearth.com", phone: "555-0104" } },
  { id: "s5", position: "Nurse Aide", department: "Clinical Support", isActive: false, hireDate: iso(1500 * D), userId: "u6", user: { name: "Maria Santos", email: "maria.santos@goldenhearth.com", phone: "555-0103" } },
];

const vitals = [
  { id: "v1", type: "HEART_RATE", value: "78", unit: "bpm", recordedAt: iso(1 * H), resident: residentRef(residentsBase[0]) },
  { id: "v2", type: "BLOOD_PRESSURE", value: "138/82", unit: "mmHg", recordedAt: iso(1 * H), resident: residentRef(residentsBase[0]) },
  { id: "v3", type: "OXYGEN", value: "96", unit: "%", recordedAt: iso(1 * H), resident: residentRef(residentsBase[0]) },
  { id: "v4", type: "TEMPERATURE", value: "37.0", unit: "°C", recordedAt: iso(1 * H), resident: residentRef(residentsBase[0]) },
  { id: "v5", type: "HEART_RATE", value: "68", unit: "bpm", recordedAt: iso(2 * H), resident: residentRef(residentsBase[1]) },
  { id: "v6", type: "OXYGEN", value: "94", unit: "%", recordedAt: iso(1 * H), resident: residentRef(residentsBase[3]) },
];

const tasks = [
  { id: "t1", title: "Assist Arthur with breakfast", status: "COMPLETED", priority: "HIGH", dueDate: iso(-1 * H), completedAt: iso(1 * H), description: "Soft foods; assist with utensils.", resident: residentRef(residentsBase[0]) },
  { id: "t2", title: "Medication distribution", status: "PENDING", priority: "URGENT", dueDate: iso(-2 * H), description: "Blood pressure med + daily vitamin.", resident: residentRef(residentsBase[1]) },
  { id: "t3", title: "Physical therapy session", status: "IN_PROGRESS", priority: "HIGH", dueDate: iso(-4 * H), description: "30-min session; track mobility.", resident: residentRef(residentsBase[2]) },
  { id: "t4", title: "Monitor vital signs", status: "PENDING", priority: "URGENT", dueDate: iso(-1 * H), description: "Record BP, HR, Temp.", resident: residentRef(residentsBase[3]) },
  { id: "t5", title: "Assist with bathing", status: "PENDING", priority: "MEDIUM", dueDate: iso(-6 * H), description: "Safety equipment ready.", resident: residentRef(residentsBase[0]) },
];

const messages = [
  { id: "msg1", subject: "Daily update", content: "Arthur had a great day and enjoyed the garden walk.", messageType: "GENERAL", isRead: false, createdAt: iso(2 * H) },
  { id: "msg2", subject: "Thank you", content: "Thank you for the update — much appreciated.", messageType: "GENERAL", isRead: true, createdAt: iso(20 * H) },
  { id: "msg3", subject: "Vitals stable", content: "This week's vitals are stable. No concerns.", messageType: "NOTIFICATION", isRead: false, createdAt: iso(1 * D) },
];

const invoices = [
  { id: "inv1", invoiceNumber: "INV-2026-0302", totalAmount: 4800, amountPaid: 4800, status: "PAID", dueDate: iso(-15 * D), billingPeriodStart: iso(30 * D), billingPeriodEnd: iso(0), description: "Monthly assisted living care" },
  { id: "inv2", invoiceNumber: "INV-2026-0305", totalAmount: 6200, amountPaid: 0, status: "SENT", dueDate: iso(-10 * D), billingPeriodStart: iso(30 * D), billingPeriodEnd: iso(0), description: "Monthly memory care" },
  { id: "inv3", invoiceNumber: "INV-2026-0312", totalAmount: 7100, amountPaid: 0, status: "OVERDUE", dueDate: iso(5 * D), billingPeriodStart: iso(60 * D), billingPeriodEnd: iso(30 * D), description: "Skilled nursing care" },
];

const visits = [
  { id: "vs1", visitorName: "John Pendelton", relationship: "Son", checkInTime: iso(2 * D), purpose: "Family visit" },
  { id: "vs2", visitorName: "Dr. Alan Reyes", relationship: "Physician", checkInTime: iso(1 * D), purpose: "Medical review" },
];

const shiftReports = [
  { id: "sr1", date: iso(1 * D), shiftType: "MORNING", summary: "Quiet shift. All residents stable.", handoverNotes: "Watch Room 312 BP." },
  { id: "sr2", date: iso(0), shiftType: "AFTERNOON", summary: "PT sessions completed. One fall alert resolved.", handoverNotes: "Room 305 needs supervision overnight." },
];

const notifications = [
  { id: "n1", type: "VITAL_ALERT", title: "Vitals recorded", message: "New vitals logged for Arthur Pendelton.", isRead: false, createdAt: iso(1 * H) },
  { id: "n2", type: "MESSAGE", title: "New message", message: "You have a new message from the care team.", isRead: false, createdAt: iso(3 * H) },
];

const callBells = [
  { id: "cb1", status: "PENDING", reason: "Assistance requested", createdAt: iso(1 * H), resident: residentRef(residentsBase[3]) },
  { id: "cb2", status: "RESOLVED", reason: "Water refill", resolvedAt: iso(3 * H), createdAt: iso(4 * H), resident: residentRef(residentsBase[1]) },
];

export const DEMO: Record<string, any[]> = {
  users: staff.map((s) => ({ id: s.userId, ...s.user, role: "STAFF" })),
  residents,
  staff,
  vitals,
  incidents,
  medications,
  tasks,
  messages,
  "shift-reports": shiftReports,
  notifications,
  visits,
  invoices,
  "resident-notes": [],
  "medical-notes": [],
  "call-bells": callBells,
  "time-tracking": [],
};

export const DEMO_STATS = {
  residents: residents.length,
  activeIncidents: incidents.filter((i) => !i.resolvedAt).length,
  activeStaff: staff.filter((s) => s.isActive).length,
  openTasks: tasks.filter((t) => t.status !== "COMPLETED").length,
  pendingCallBells: callBells.filter((c) => c.status === "PENDING").length,
  overdueInvoices: invoices.filter((i) => i.status === "OVERDUE").length,
};
