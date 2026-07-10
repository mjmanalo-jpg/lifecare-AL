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
  { id: "m1", name: "Lisinopril", dosage: "10mg", frequency: "Daily", route: "oral", status: "ACTIVE", startDate: iso(300 * D), residentId: "r1", prescribedBy: "Dr. Alan Reyes", reason: "Hypertension" },
  { id: "m2", name: "Metformin", dosage: "500mg", frequency: "Twice daily", route: "oral", status: "ACTIVE", startDate: iso(300 * D), residentId: "r1", prescribedBy: "Dr. Alan Reyes", reason: "Type 2 Diabetes" },
  { id: "m3", name: "Donepezil", dosage: "5mg", frequency: "Daily", route: "oral", status: "ACTIVE", startDate: iso(400 * D), residentId: "r2", prescribedBy: "Dr. Alan Reyes", reason: "Alzheimer's" },
  { id: "m4", name: "Warfarin", dosage: "5mg", frequency: "Daily", route: "oral", status: "ACTIVE", startDate: iso(120 * D), residentId: "r4", prescribedBy: "Dr. Alan Reyes", reason: "Atrial fibrillation", contraindications: "Monitor INR; avoid NSAIDs" },
  { id: "m5", name: "Acetaminophen", dosage: "500mg", frequency: "PRN (as needed)", route: "oral", status: "ACTIVE", startDate: iso(30 * D), residentId: "r5", prescribedBy: "Dr. Alan Reyes", reason: "Post-surgical pain" },
  { id: "m6", name: "Atorvastatin", dosage: "20mg", frequency: "At bedtime", route: "oral", status: "ON_HOLD", startDate: iso(200 * D), residentId: "r3", prescribedBy: "Dr. Alan Reyes", reason: "High cholesterol", sideEffects: "Muscle aches reported — on hold pending review" },
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
  { id: "inv1", residentId: "r1", invoiceNumber: "INV-2026-0302", totalAmount: 4800, amountPaid: 4800, status: "PAID", dueDate: iso(-15 * D), billingPeriodStart: iso(30 * D), billingPeriodEnd: iso(0), description: "Monthly assisted living care" },
  { id: "inv2", residentId: "r2", invoiceNumber: "INV-2026-0305", totalAmount: 6200, amountPaid: 0, status: "SENT", dueDate: iso(-10 * D), billingPeriodStart: iso(30 * D), billingPeriodEnd: iso(0), description: "Monthly memory care" },
  { id: "inv3", residentId: "r4", invoiceNumber: "INV-2026-0312", totalAmount: 7100, amountPaid: 0, status: "OVERDUE", dueDate: iso(5 * D), billingPeriodStart: iso(60 * D), billingPeriodEnd: iso(30 * D), description: "Skilled nursing care" },
];

const visits = [
  { id: "vs1", residentId: "r1", visitorName: "John Pendelton", relationship: "Son", checkInTime: iso(2 * D), purpose: "Family visit" },
  { id: "vs2", residentId: "r2", visitorName: "Dr. Alan Reyes", relationship: "Physician", checkInTime: iso(1 * D), purpose: "Medical review" },
];

const shiftReports = [
  { id: "sr1", date: iso(1 * D), shiftType: "MORNING", summary: "Quiet shift. All residents stable.", handoverNotes: "Watch Room 312 BP." },
  { id: "sr2", date: iso(0), shiftType: "AFTERNOON", summary: "PT sessions completed. One fall alert resolved.", handoverNotes: "Room 305 needs supervision overnight." },
];

const notifications = [
  { id: "n1", userId: "u1", type: "VITAL_ALERT", title: "Arthur's Vitals Alert", message: "Heart rate elevated to 104 bpm during therapy. Now stable.", isRead: false, createdAt: iso(1 * H) },
  { id: "n2", userId: "u1", type: "MEDICATION_REMINDER", title: "Medication Due", message: "Blood pressure medication due in 15 minutes.", isRead: false, createdAt: iso(0.5 * H) },
  { id: "n3", userId: "u2", type: "CALL_BELL", title: "Room 302 Call Bell", message: "Arthur Pendelton triggered the room call bell. Assistance needed.", isRead: false, createdAt: iso(0.15 * H) },
  { id: "n4", userId: "u2", type: "TASK_ASSIGNMENT", title: "Morning Wellness Check", message: "3 residents awaiting morning vitals assessment.", isRead: false, createdAt: iso(2 * H) },
  { id: "n5", userId: "u3", type: "INCIDENT_REPORT", title: "Incident Logged", message: "Caregiver logged a call bell response event in Room 305.", isRead: false, createdAt: iso(1.5 * H) },
  { id: "n6", userId: "u3", type: "SHIFT_REMINDER", title: "Clock-In Reminder", message: "Afternoon shift starts in 30 minutes.", isRead: true, createdAt: iso(3 * H) },
];

const callBells = [
  { id: "cb1", status: "PENDING", reason: "Assistance requested", createdAt: iso(1 * H), resident: residentRef(residentsBase[3]) },
  { id: "cb2", status: "RESOLVED", reason: "Water refill", resolvedAt: iso(3 * H), respondedAt: iso(3.9 * H), createdAt: iso(4 * H), resident: residentRef(residentsBase[1]) },
  { id: "cb3", status: "RESPONDED", reason: "Repositioning help", respondedAt: iso(0.2 * H), createdAt: iso(0.4 * H), resident: residentRef(residentsBase[0]) },
  { id: "cb4", status: "RESOLVED", reason: "Bathroom assistance", resolvedAt: iso(26 * H), respondedAt: iso(26.2 * H), createdAt: iso(26.5 * H), notes: "Assisted safely back to bed.", resident: residentRef(residentsBase[4]) },
];

const staffRef = (s: any) => ({ user: { name: s.user.name } });

const timeTracking = [
  { id: "tt1", staffId: "s3", staff: staffRef(staff[2]), shiftType: "MORNING", startTime: iso(3 * H), endTime: null, breakDuration: 15, status: "PRESENT", notes: null },
  { id: "tt2", staffId: "s4", staff: staffRef(staff[3]), shiftType: "MORNING", startTime: iso(27 * H), endTime: iso(19 * H), breakDuration: 30, status: "PRESENT", notes: "Covered east wing." },
  { id: "tt3", staffId: "s3", staff: staffRef(staff[2]), shiftType: "AFTERNOON", startTime: iso(2 * D), endTime: iso(2 * D - 8 * H), breakDuration: 45, status: "LATE", notes: "Traffic delay." },
  { id: "tt4", staffId: "s4", staff: staffRef(staff[3]), shiftType: "NIGHT", startTime: iso(3 * D), endTime: iso(3 * D - 5 * H), breakDuration: 20, status: "EARLY_LEAVE", notes: "Left early — family emergency." },
];

const admissions = [
  {
    id: "adm1", firstName: "Dorothy", lastName: "Hale", dateOfBirth: iso(81 * 365 * D),
    gender: "Female", phone: "555-0311", email: "family.hale@example.com",
    emergencyContact: "Grace Hale", emergencyContactPhone: "555-0312",
    medicalAssessment: "Mild hypertension; independent ADLs.", allergies: "None known",
    medicalHistory: "Hypertension", careAssessment: "Needs medication reminders.",
    careLevel: "ASSISTED", mobility: "Walker",
    insuranceProvider: "Medicare", insurancePolicyNumber: "MED-88213", insuranceVerified: true, insuranceVerifiedAt: iso(2 * D),
    roomNumber: "314", qrPayload: "GH-RES-adm1",
    careTeam: JSON.stringify([{ id: "s1", name: "Sarah Jenkins", role: "Head Nurse" }, { id: "s3", name: "Caleb Randall", role: "Caregiver" }]),
    carePlan: "Daily BP checks, medication reminders, social activities.", carePlanGoals: "Maintain independence; stable BP.",
    currentStep: 8, completedSteps: "[1,2,3,4,5,6,7]", status: "IN_PROGRESS",
    sponsorId: null, residentId: null, createdAt: iso(3 * D), updatedAt: iso(2 * H),
  },
  {
    id: "adm2", firstName: "Frank", lastName: "Osei", dateOfBirth: iso(74 * 365 * D),
    gender: "Male", phone: "555-0321", email: "osei.family@example.com",
    emergencyContact: "Ama Osei", emergencyContactPhone: "555-0322",
    medicalAssessment: null, allergies: null, medicalHistory: null,
    careAssessment: null, careLevel: null, mobility: null,
    insuranceProvider: null, insurancePolicyNumber: null, insuranceVerified: false, insuranceVerifiedAt: null,
    roomNumber: null, qrPayload: null, careTeam: null, carePlan: null, carePlanGoals: null,
    currentStep: 2, completedSteps: "[1]", status: "IN_PROGRESS",
    sponsorId: null, residentId: null, createdAt: iso(6 * H), updatedAt: iso(1 * H),
  },
];

const rooms = [
  { id: "rm1", roomNumber: "101", floor: 1, wing: "East", roomType: "PRIVATE", capacity: 1, status: "AVAILABLE", features: "Wheelchair accessible, Call system", rateMonthly: 4200 },
  { id: "rm2", roomNumber: "102", floor: 1, wing: "East", roomType: "SEMI_PRIVATE", capacity: 2, status: "OCCUPIED", features: "Shared bath, Window view", rateMonthly: 3200 },
  { id: "rm3", roomNumber: "103", floor: 1, wing: "West", roomType: "PRIVATE", capacity: 1, status: "MAINTENANCE", features: "AC, Private bath", rateMonthly: 4500, notes: "Paint scheduled" },
  { id: "rm4", roomNumber: "201", floor: 2, wing: "East", roomType: "PRIVATE", capacity: 1, status: "OCCUPIED", features: "Balcony, AC", rateMonthly: 4800 },
  { id: "rm5", roomNumber: "202", floor: 2, wing: "East", roomType: "SEMI_PRIVATE", capacity: 2, status: "OCCUPIED", features: "Shared bath", rateMonthly: 3400 },
  { id: "rm6", roomNumber: "203", floor: 2, wing: "West", roomType: "SUITE", capacity: 1, status: "RESERVED", features: "Living room, Kitchenette, Balcony", rateMonthly: 6500 },
  { id: "rm7", roomNumber: "301", floor: 3, wing: "West", roomType: "PRIVATE", capacity: 1, status: "AVAILABLE", features: "Garden view, AC", rateMonthly: 4600 },
  { id: "rm8", roomNumber: "302", floor: 3, wing: "West", roomType: "PRIVATE", capacity: 1, status: "OCCUPIED", features: "AC, Call system", rateMonthly: 4600 },
  { id: "rm9", roomNumber: "305", floor: 3, wing: "West", roomType: "PRIVATE", capacity: 1, status: "OCCUPIED", features: "AC, Window view", rateMonthly: 4600 },
  { id: "rm10", roomNumber: "308", floor: 3, wing: "East", roomType: "SEMI_PRIVATE", capacity: 2, status: "OCCUPIED", features: "Shared bath", rateMonthly: 3400 },
  { id: "rm11", roomNumber: "310", floor: 3, wing: "East", roomType: "PRIVATE", capacity: 1, status: "OCCUPIED", features: "AC, Private bath", rateMonthly: 4800 },
  { id: "rm12", roomNumber: "312", floor: 3, wing: "East", roomType: "PRIVATE", capacity: 1, status: "OCCUPIED", features: "AC, Emergency call", rateMonthly: 4800 },
];

const inventoryItems = [
  { id: "inv1", itemName: "Nitrile Gloves (Box)", category: "PPE", quantity: 240, unit: "boxes", minimumStock: 50, location: "Storage A", supplier: "MedSupply Co.", expiryDate: iso(365 * D) },
  { id: "inv2", itemName: "Face Masks (Box)", category: "PPE", quantity: 120, unit: "boxes", minimumStock: 30, location: "Storage A", supplier: "MedSupply Co.", expiryDate: iso(180 * D) },
  { id: "inv3", itemName: "Hand Sanitizer", category: "CLEANING", quantity: 48, unit: "bottles", minimumStock: 20, location: "Storage B", supplier: "CleanPro Ltd." },
  { id: "inv4", itemName: "Adult Diapers (Large)", category: "PERSONAL_CARE", quantity: 200, unit: "pcs", minimumStock: 50, location: "Storage C", supplier: "CarePlus Inc." },
  { id: "inv5", itemName: "Disposable Bed Sheets", category: "LINEN", quantity: 300, unit: "pcs", minimumStock: 100, location: "Storage B", supplier: "LinensDirect" },
  { id: "inv6", itemName: "Blood Pressure Cuffs", category: "MEDICAL_SUPPLIES", quantity: 15, unit: "pcs", minimumStock: 10, location: "Equipment Room", supplier: "MedSupply Co." },
  { id: "inv7", itemName: "Wheelchair", category: "EQUIPMENT", quantity: 8, unit: "pcs", minimumStock: 5, location: "Equipment Room", supplier: "MobilityPlus" },
  { id: "inv8", itemName: "Disposable Cups", category: "FOOD", quantity: 500, unit: "pcs", minimumStock: 200, location: "Kitchen", supplier: "Restaurant Supply" },
  { id: "inv9", itemName: "Antiseptic Wipes", category: "CLEANING", quantity: 80, unit: "containers", minimumStock: 25, location: "Storage A", supplier: "CleanPro Ltd.", expiryDate: iso(200 * D) },
  { id: "inv10", itemName: "Overbed Tables", category: "FURNITURE", quantity: 12, unit: "pcs", minimumStock: 5, location: "Furniture Storage", supplier: "FurniturePlus" },
];
const blogPosts = [
  {
    id: "bp1",
    title: "Welcome to Golden Hearth Wellness Residence",
    description: "Discover our state-of-the-art assisted living facility, designed with warmth, luxury, and cutting-edge AI wellness monitoring for every resident.",
    content: "At Golden Hearth, we believe that aging should be a graceful, dignified experience. Our facility combines luxury hospitality with clinical excellence, offering residents a vibrant community where they can thrive.\n\nOur AI-powered monitoring systems ensure safety without intrusiveness, while our dedicated care teams provide personalized attention around the clock.\n\n## What Makes Us Different\n\n- **Optical Matrix Fall Detection** — Real-time edge-computed vision systems\n- **Voice AI Charting** — Hands-free documentation for our nursing staff\n- **Family Transparency** — Real-time dashboards keeping families connected",
    imageUrl: "/sanctuary_lounge.png",
    author: "Dr. Eleanor Whitfield",
    publishedAt: iso(2 * D),
    published: true,
    createdAt: iso(2 * D),
    updatedAt: iso(2 * D),
  },
  {
    id: "bp2",
    title: "Introducing Our New Tranquility Gardens",
    description: "Our newly expanded outdoor wellness gardens feature therapeutic walking paths, serene ponds, and dedicated meditation areas for residents and families.",
    content: "We are thrilled to announce the completion of our Tranquility Gardens expansion. These beautifully landscaped outdoor spaces have been designed in collaboration with horticultural therapists to promote mobility, relaxation, and social engagement.\n\n## Features\n\n- Japanese-inspired zen gardens with koi ponds\n- Covered walking paths accessible in all weather\n- Raised garden beds for resident gardening therapy\n- Outdoor seating areas for family visits",
    imageUrl: "/sanctuary_garden.png",
    author: "Margaret Chen, Activities Director",
    publishedAt: iso(5 * D),
    published: true,
    createdAt: iso(5 * D),
    updatedAt: iso(5 * D),
  },
  {
    id: "bp3",
    title: "Monthly Wellness Report: June 2026",
    description: "Our latest wellness metrics show a 98.7% resident satisfaction rate and zero critical incidents this month, thanks to our proactive AI monitoring systems.",
    content: "We are proud to share our June 2026 wellness report, highlighting the continued success of our integrated care approach.\n\n## Key Metrics\n\n- **Resident Satisfaction**: 98.7% (up from 97.2%)\n- **Fall Prevention Rate**: 99.9%\n- **Average Response Time**: Under 45 seconds\n- **Family Portal Engagement**: 89% weekly active usage\n\nThese results reflect our team's unwavering commitment to excellence in eldercare.",
    imageUrl: "/sanctuary_exterior.png",
    author: "System Admin",
    publishedAt: iso(10 * D),
    published: true,
    createdAt: iso(10 * D),
    updatedAt: iso(10 * D),
  },
];

const siteContent = [
  { id: "hero_title", value: "Care Redefined.", updatedAt: iso(0) },
  { id: "hero_subtitle", value: "For Peaceful Living.", updatedAt: iso(0) },
  { id: "hero_description", value: "A cinematic, minimalist approach to elder care management. Equipped with Real-Time Optical Safety Matrices and friendly, responsive voice assistants. Engineered for deep empathy and supreme operational efficiency.", updatedAt: iso(0) },
  { id: "feature_1_title", value: "Optical Matrix", updatedAt: iso(0) },
  { id: "feature_1_desc", value: "Real-time edge-computed anomaly and fall detection ensuring absolute resident safety.", updatedAt: iso(0) },
  { id: "feature_2_title", value: "Voice Assistant", updatedAt: iso(0) },
  { id: "feature_2_desc", value: "Low-latency conversational AI for hands-free charting and friendly companionship.", updatedAt: iso(0) },
  { id: "feature_3_title", value: "Secure Family Portal", updatedAt: iso(0) },
  { id: "feature_3_desc", value: "Private health logs and vitals synced in real-time with family dashboards.", updatedAt: iso(0) },
  { id: "footer_text", value: "© 2026 AI Powered Assisted Living. All rights reserved.", updatedAt: iso(0) },
];

const customPages = [
  {
    id: "cp1",
    title: "About Us",
    slug: "about-us",
    content: "# About Golden Hearth\n\nGolden Hearth Wellness Residence is a premier assisted living facility that combines luxury hospitality with cutting-edge AI-powered care technology.\n\n## Our Mission\n\nTo redefine eldercare through compassionate, technology-enhanced living that preserves dignity, promotes wellness, and keeps families connected.\n\n## Our Values\n\n- **Empathy First** — Every decision is guided by compassion\n- **Innovation** — We leverage AI to enhance, never replace, human care\n- **Transparency** — Families stay informed through real-time dashboards\n- **Excellence** — We hold ourselves to the highest standards of care",
    published: true,
    sortOrder: 1,
    createdAt: iso(30 * D),
    updatedAt: iso(30 * D),
  },
];

export const DEMO: Record<string, any[]> = {
  users: staff.map((s) => ({ id: s.userId, ...s.user, role: "STAFF" })),
  admissions,
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
  "time-tracking": timeTracking,
  "knowledge-docs": [],
  "app-settings": [],
  rooms,
  inventory: inventoryItems,
  "blog-posts": blogPosts,
  "site-content": siteContent,
  "custom-pages": customPages,
};

export const DEMO_STATS = {
  residents: residents.length,
  activeIncidents: incidents.filter((i) => !i.resolvedAt).length,
  activeStaff: staff.filter((s) => s.isActive).length,
  openTasks: tasks.filter((t) => t.status !== "COMPLETED").length,
  pendingCallBells: callBells.filter((c) => c.status === "PENDING").length,
  overdueInvoices: invoices.filter((i) => i.status === "OVERDUE").length,
};
