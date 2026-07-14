/**
 * Idempotent seed for the assisted-living database.
 * Run after DATABASE_URL/DIRECT_URL are set in .env.local:
 *   npx prisma db seed
 *
 * Safe to re-run: users/residents/staff/invoices upsert on their unique keys;
 * high-volume child tables (vitals, incidents, tasks, …) only seed when empty.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const daysAgo = (n) => new Date(Date.now() - n * 24 * 3600 * 1000);
const hoursAgo = (n) => new Date(Date.now() - n * 3600 * 1000);
const inDays = (n) => new Date(Date.now() + n * 24 * 3600 * 1000);

async function seedUsers() {
  const users = [
    { email: "admin@goldenhearth.com", name: "System Admin", role: "SUPERADMIN", phone: "555-0100" },
    { email: "facility.admin@goldenhearth.com", name: "Facility Admin", role: "FACILITY_ADMIN", phone: "555-0150" },
    { email: "alan.reyes@goldenhearth.com", name: "Dr. Alan Reyes", role: "PHYSICIAN", phone: "555-0160" },
    { email: "sarah.jenkins@goldenhearth.com", name: "Sarah Jenkins", role: "NURSE", phone: "555-0101" },
    { email: "rebecca.wilson@goldenhearth.com", name: "Rebecca Wilson", role: "NURSE", phone: "555-0105" },
    { email: "caleb.randall@goldenhearth.com", name: "Caleb Randall", role: "CAREGIVER", phone: "555-0102" },
    { email: "james.mitchell@goldenhearth.com", name: "James Mitchell", role: "CAREGIVER", phone: "555-0104" },
    { email: "maria.santos@goldenhearth.com", name: "Maria Santos", role: "CAREGIVER", phone: "555-0103" },
    { email: "john.pendelton@family.com", name: "John Pendelton", role: "FAMILY", phone: "555-0200" },
    { email: "arthur.pendelton@resident.com", name: "Arthur Pendelton", role: "RESIDENT", phone: "555-0201" },
    { email: "fleet.manager@goldenhearth.com", name: "Marcus Dela Cruz", role: "FLEET_MANAGEMENT", phone: "555-0400" },
    { email: "james.miguel@goldenhearth.com", name: "James Miguel", role: "DRIVER", phone: "555-0401" },
  ];
  const out = {};
  for (const u of users) {
    const rec = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, phone: u.phone },
      create: u,
    });
    out[u.email] = rec;
  }
  return out;
}

async function seedStaff(users) {
  const rows = [
    { email: "alan.reyes@goldenhearth.com", position: "Physician", department: "Medical", hireDate: daysAgo(1000), isApproved: true },
    { email: "sarah.jenkins@goldenhearth.com", position: "Head Nurse", department: "Clinical Care", hireDate: daysAgo(1200), isApproved: true },
    { email: "rebecca.wilson@goldenhearth.com", position: "RN - Supervisor", department: "Clinical Care", hireDate: daysAgo(1800), isApproved: true },
    { email: "caleb.randall@goldenhearth.com", position: "Caregiver", department: "Daily Assistance", hireDate: daysAgo(560), isApproved: true },
    { email: "james.mitchell@goldenhearth.com", position: "Caregiver", department: "Daily Assistance", hireDate: daysAgo(300), isApproved: false },
    { email: "maria.santos@goldenhearth.com", position: "Nurse Aide", department: "Clinical Support", hireDate: daysAgo(1500), isActive: false, isApproved: false },
  ];
  const out = [];
  for (const r of rows) {
    const user = users[r.email];
    if (!user) continue;
    const rec = await prisma.staff.upsert({
      where: { userId: user.id },
      update: { position: r.position, department: r.department, isActive: r.isActive ?? true, isApproved: r.isApproved ?? true },
      create: { userId: user.id, position: r.position, department: r.department, hireDate: r.hireDate, isActive: r.isActive ?? true, isApproved: r.isApproved ?? true },
    });
    out.push(rec);
  }
  return out;
}

async function seedResidents() {
  const rows = [
    { firstName: "Arthur", lastName: "Pendelton", roomNumber: "302", careLevel: "ASSISTED", admissionDate: daysAgo(400), dateOfBirth: daysAgo(78 * 365), allergies: "Penicillin, Sulfa drugs", medicalHistory: "Hypertension, Type 2 Diabetes", notes: "Stable condition. Regular monitoring." },
    { firstName: "Eleanor", lastName: "Fitzroy", roomNumber: "305", careLevel: "MEMORY", admissionDate: daysAgo(620), dateOfBirth: daysAgo(85 * 365), allergies: "None known", medicalHistory: "Alzheimer's, Arthritis", notes: "Memory decline noted. Increase supervision." },
    { firstName: "Robert", lastName: "Chen", roomNumber: "310", careLevel: "INDEPENDENT", admissionDate: daysAgo(210), dateOfBirth: daysAgo(72 * 365), allergies: "None known", medicalHistory: "High Cholesterol", notes: "Self-sufficient." },
    { firstName: "Margaret", lastName: "Wilson", roomNumber: "312", careLevel: "SKILLED", admissionDate: daysAgo(150), dateOfBirth: daysAgo(80 * 365), allergies: "Codeine", medicalHistory: "Atrial Fibrillation, Heart Failure", notes: "BP elevated. Monitor closely." },
    { firstName: "James", lastName: "Murphy", roomNumber: "308", careLevel: "ASSISTED", admissionDate: daysAgo(95), dateOfBirth: daysAgo(76 * 365), allergies: "None known", medicalHistory: "Post-Surgery Recovery", notes: "Recovering well; PT progressing." },
  ];
  const out = {};
  for (const r of rows) {
    const rec = await prisma.resident.upsert({
      where: { roomNumber: r.roomNumber },
      update: { firstName: r.firstName, lastName: r.lastName, careLevel: r.careLevel, allergies: r.allergies, medicalHistory: r.medicalHistory, notes: r.notes },
      create: r,
    });
    out[r.roomNumber] = rec;
  }
  return out;
}

async function seedIfEmpty(model, makeRows) {
  const count = await prisma[model].count();
  if (count > 0) {
    console.log(`  • ${model}: ${count} rows exist — skipping`);
    return;
  }
  const rows = makeRows();
  if (!rows.length) return;
  await prisma[model].createMany({ data: rows });
  console.log(`  • ${model}: created ${rows.length}`);
}

async function main() {
  console.log("Seeding database…");
  const users = await seedUsers();
  const staff = await seedStaff(users);
  const residents = await seedResidents();

  const R = residents;
  const nurse = staff.find((s) => s.position === "Head Nurse");
  const caregiver = staff.find((s) => s.position === "Caregiver");
  const nurseUser = users["sarah.jenkins@goldenhearth.com"];
  const familyUser = users["john.pendelton@family.com"];
  const residentUser = users["arthur.pendelton@resident.com"];

  // Link the family sponsor AND the resident self-login to Arthur (Room 302) so
  // both the Family and Resident portals are scoped to exactly that record.
  if (R["302"]) {
    await prisma.resident.update({
      where: { roomNumber: "302" },
      data: {
        ...(familyUser ? { sponsorId: familyUser.id } : {}),
        ...(residentUser ? { userId: residentUser.id } : {}),
      },
    });
    console.log("  • linked family sponsor + resident self-login → Room 302");
  }

  await seedIfEmpty("vitalsLog", () => [
    { residentId: R["302"].id, type: "HEART_RATE", value: "78", unit: "bpm", recordedAt: hoursAgo(1) },
    { residentId: R["302"].id, type: "BLOOD_PRESSURE", value: "138/82", unit: "mmHg", recordedAt: hoursAgo(1) },
    { residentId: R["302"].id, type: "OXYGEN", value: "96", unit: "%", recordedAt: hoursAgo(1) },
    { residentId: R["302"].id, type: "TEMPERATURE", value: "37.0", unit: "°C", recordedAt: hoursAgo(1) },
    { residentId: R["305"].id, type: "HEART_RATE", value: "68", unit: "bpm", recordedAt: hoursAgo(2) },
    { residentId: R["312"].id, type: "HEART_RATE", value: "82", unit: "bpm", recordedAt: hoursAgo(1) },
    { residentId: R["312"].id, type: "OXYGEN", value: "94", unit: "%", recordedAt: hoursAgo(1) },
  ]);

  await seedIfEmpty("incident", () => [
    { residentId: R["305"].id, incidentType: "FALL", severity: "CRITICAL", title: "Unsteady gait", description: "Resident nearly fell during ambulation.", incidentDate: hoursAgo(1), immediateActions: "Assigned mobility assistance." },
    { residentId: R["302"].id, incidentType: "MEDICATION_ERROR", severity: "SEVERE", description: "Wrong dosage administered.", incidentDate: hoursAgo(4), followUpRequired: true, followUpNotes: "Physician notified. Monitoring vitals." },
    { residentId: R["312"].id, incidentType: "INFECTION", severity: "CRITICAL", description: "Signs of urinary tract infection.", incidentDate: hoursAgo(12), immediateActions: "Lab culture sent; started antibiotics." },
    { residentId: R["310"].id, incidentType: "OTHER", severity: "MODERATE", description: "Blood pressure spike to 165/95.", incidentDate: daysAgo(1), resolvedAt: hoursAgo(20) },
  ]);

  await seedIfEmpty("medication", () => [
    { residentId: R["302"].id, name: "Lisinopril", dosage: "10mg", frequency: "Daily", startDate: daysAgo(300) },
    { residentId: R["302"].id, name: "Metformin", dosage: "500mg", frequency: "Twice daily", startDate: daysAgo(300) },
    { residentId: R["305"].id, name: "Donepezil", dosage: "5mg", frequency: "Daily", startDate: daysAgo(400) },
    { residentId: R["312"].id, name: "Warfarin", dosage: "5mg", frequency: "Daily", startDate: daysAgo(120) },
  ]);

  await seedIfEmpty("task", () => [
    { residentId: R["302"].id, title: "Assist Arthur with breakfast", dueDate: hoursAgo(-1), priority: "HIGH", status: "COMPLETED", completedAt: hoursAgo(1), description: "Soft foods; assist with utensils.", assignedToId: caregiver?.id ?? null },
    { residentId: R["305"].id, title: "Medication distribution", dueDate: hoursAgo(-2), priority: "URGENT", status: "PENDING", description: "Blood pressure med + daily vitamin.", assignedToId: caregiver?.id ?? null },
    { residentId: R["310"].id, title: "Physical therapy session", dueDate: hoursAgo(-4), priority: "HIGH", status: "IN_PROGRESS", description: "30-min session; track mobility.", assignedToId: caregiver?.id ?? null },
    { residentId: R["312"].id, title: "Monitor vital signs", dueDate: hoursAgo(-1), priority: "URGENT", status: "PENDING", description: "Record BP, HR, Temp.", assignedToId: caregiver?.id ?? null },
    { residentId: R["302"].id, title: "Assist with bathing", dueDate: hoursAgo(-6), priority: "MEDIUM", status: "PENDING", description: "Safety equipment ready.", assignedToId: caregiver?.id ?? null },
  ]);

  if (nurseUser && familyUser) {
    await seedIfEmpty("message", () => [
      { senderId: nurseUser.id, recipientId: familyUser.id, subject: "Daily update", content: "Arthur had a great day and enjoyed the garden walk.", messageType: "GENERAL" },
      { senderId: familyUser.id, recipientId: nurseUser.id, subject: "Thank you", content: "Thank you for the update — much appreciated.", messageType: "GENERAL", isRead: true },
      { senderId: nurseUser.id, recipientId: familyUser.id, subject: "Vitals stable", content: "This week's vitals are stable. No concerns.", messageType: "NOTIFICATION" },
    ]);
  }

  await seedIfEmpty("visit", () => [
    { residentId: R["302"].id, visitorName: "John Pendelton", relationship: "Son", checkInTime: daysAgo(2), purpose: "Family visit" },
    { residentId: R["305"].id, visitorName: "Dr. Alan Reyes", relationship: "Physician", checkInTime: daysAgo(1), purpose: "Medical review" },
  ]);

  await seedIfEmpty("invoice", () => [
    { residentId: R["302"].id, invoiceNumber: "INV-2026-0302", billingPeriodStart: daysAgo(30), billingPeriodEnd: new Date(), totalAmount: 4800, amountPaid: 4800, dueDate: inDays(15), status: "PAID", description: "Monthly assisted living care" },
    { residentId: R["305"].id, invoiceNumber: "INV-2026-0305", billingPeriodStart: daysAgo(30), billingPeriodEnd: new Date(), totalAmount: 6200, amountPaid: 0, dueDate: inDays(10), status: "SENT", description: "Monthly memory care" },
    { residentId: R["312"].id, invoiceNumber: "INV-2026-0312", billingPeriodStart: daysAgo(60), billingPeriodEnd: daysAgo(30), totalAmount: 7100, amountPaid: 0, dueDate: daysAgo(5), status: "OVERDUE", description: "Skilled nursing care" },
  ]);

  const invPaid = await prisma.invoice.findUnique({ where: { invoiceNumber: "INV-2026-0302" } });
  if (invPaid) {
    await seedIfEmpty("payment", () => [
      { invoiceId: invPaid.id, amount: 4800, paymentDate: daysAgo(14), paymentMethod: "CARD", transactionId: "TXN-9988234", notes: "Monthly sponsor portal payment automated capture." }
    ]);
  }

  await seedIfEmpty("serviceCharge", () => [
    { residentId: R["302"].id, description: "Standard Therapy Copay", amount: 150, serviceDate: daysAgo(5), category: "Specialist Therapy" },
    { residentId: R["302"].id, description: "Monthly Prescriptions", amount: 75, serviceDate: daysAgo(4), category: "Medication Fee" },
    { residentId: R["305"].id, description: "Extra Memory Suite Dining", amount: 120, serviceDate: daysAgo(10), category: "Dining Services" },
    { residentId: R["312"].id, description: "Emergency Wound Dressing", amount: 350, serviceDate: daysAgo(2), category: "Care Services" },
  ]);

  await seedIfEmpty("insuranceValidation", () => [
    { residentId: R["302"].id, provider: "Aetna Senior Care", policyNumber: "AET-388291", groupNumber: "GRP-HART", status: "VALIDATED", verifiedAt: daysAgo(20), verifiedBy: "Admin Portal", coverageDetails: "Covers 80% of therapy charges; 100% room rate after deductible." },
    { residentId: R["305"].id, provider: "Blue Cross Blue Shield", policyNumber: "BCBS-99120", groupNumber: "GRP-3029", status: "PENDING", coverageDetails: "Memory care coverage up to $5,000 monthly." },
    { residentId: R["312"].id, provider: "UnitedHealthcare", policyNumber: "UHC-77482", groupNumber: "GRP-9923", status: "FAILED", notes: "Expired policy on check. Needs renewal." },
  ]);

  await seedIfEmpty("callBell", () => [
    { residentId: R["312"].id, status: "PENDING", reason: "Assistance requested" },
    { residentId: R["305"].id, status: "RESOLVED", reason: "Water refill", resolvedAt: hoursAgo(3) },
  ]);

  const notificationSeeds = [];
  const addNotif = (user, type, title, message) => {
    if (user) {
      notificationSeeds.push({
        userId: user.id,
        type,
        title,
        message,
        isRead: false,
      });
    }
  };

  const adminUser = users["admin@goldenhearth.com"];
  const facAdminUser = users["facility.admin@goldenhearth.com"];
  const physicianUser = users["alan.reyes@goldenhearth.com"];
  const nurseUser2 = users["sarah.jenkins@goldenhearth.com"];
  const caregiverUser = users["caleb.randall@goldenhearth.com"];

  addNotif(adminUser, "SYSTEM_ALERT", "System Health Optimal", "All microservices and database engines responding at optimal speed (45ms).");
  addNotif(adminUser, "SYSTEM_ALERT", "Supabase Connection Healthy", "Realtime subscription pool contains 8 active channels.");
  addNotif(adminUser, "CALL_BELL", "Emergency System Checked", "Successfully verified emergency call bell route and response protocols.");

  addNotif(facAdminUser, "SYSTEM_ALERT", "Admissions Verification Pending", "Dorothy Hale is waiting for room allocation to complete step 8.");
  addNotif(facAdminUser, "INCIDENT_REPORT", "Incident Logged", "Caregiver Caleb Randall logged a call bell response event in Room 305.");
  addNotif(facAdminUser, "TASK_ASSIGNMENT", "Staff Shift Roster", "12 active care professionals have successfully clocked in for today's shifts.");

  // Physician notifications — unique to the medical-authority role.
  addNotif(physicianUser, "MEDICATION_REMINDER", "Order Awaiting Approval", "Apixaban 5mg for Margaret Wilson (Room 312) is pending your approval & e-signature.");
  addNotif(physicianUser, "MESSAGE", "Clinical Note to Co-sign", "Sarah Jenkins, RN submitted a clinical note for Arthur Pendelton (Room 302) awaiting your co-signature.");
  addNotif(physicianUser, "SYSTEM_ALERT", "New Consult Request", "Swallowing-assessment consult raised for Eleanor Fitzroy (Room 305) — awaiting your response.");
  addNotif(physicianUser, "VITAL_ALERT", "Patient Needs Assessment", "Margaret Wilson (Room 312) BP elevated at 165/95 — please review and direct care.");

  addNotif(nurseUser2, "CALL_BELL", "Emergency Call Bell: Room 302", "Arthur Pendelton triggered the room call bell. Assistance needed.");
  addNotif(nurseUser2, "VITAL_ALERT", "Arthur SpO2 Dropped", "Oxygen saturation level dipped below 95% temporarily.");
  addNotif(nurseUser2, "INCIDENT_REPORT", "Fall Heuristics Alert", "Room 305 vision feed triggered a potential balance loss warning.");

  addNotif(caregiverUser, "CALL_BELL", "Call Bell: Room 302 Assistance", "Help requested with repositioning and physical comfort checks.");
  addNotif(caregiverUser, "TASK_ASSIGNMENT", "Checklist Pending", "3 morning wellness and dietary tasks remain incomplete.");
  addNotif(caregiverUser, "SHIFT_REMINDER", "Clock-In Reminder", "Afternoon shift starts in 30 minutes. Please prepare for shift handover.");

  addNotif(familyUser, "VITAL_ALERT", "Relative Vitals Stable", "Arthur Pendelton's morning vitals registered healthy (BP 120/80).");
  addNotif(familyUser, "MEDICATION_REMINDER", "Medications Administered", "Head Nurse Sarah Jenkins successfully administered daily blood pressure pills.");
  addNotif(familyUser, "MESSAGE", "Daily Comfort Report", "Caleb Randall reports Arthur slept comfortably and participated in social games.");

  const fleetUser = users["fleet.manager@goldenhearth.com"];
  addNotif(fleetUser, "TRANSPORT_UPDATE", "New Transport Request", "Arthur Pendelton requested a dialysis run for tomorrow 8:00 AM — pending dispatcher review.");
  addNotif(fleetUser, "SYSTEM_ALERT", "Registration Expiring", "Wheelchair Van WV-001 registration expires in 14 days. Renew to stay compliant.");
  addNotif(fleetUser, "TASK_ASSIGNMENT", "Preventive Maintenance Due", "Sedan SD-001 passed its service interval — schedule preventive maintenance.");

  addNotif(residentUser, "TASK_ASSIGNMENT", "Physical Therapy Scheduled", "Your PT session with Caleb is scheduled for 2:00 PM today.");
  addNotif(residentUser, "MEDICATION_REMINDER", "Medications Reminder", "Afternoon pills are scheduled in 15 minutes.");
  addNotif(residentUser, "MESSAGE", "New Message from Sponsor", "John Pendelton shared a photo and message with your care dashboard.");

  await seedIfEmpty("notification", () => notificationSeeds);

  if (nurse && nurseUser) {
    await seedIfEmpty("shiftReport", () => [
      { staffId: nurse.id, userId: nurseUser.id, shiftType: "MORNING", date: daysAgo(1), summary: "Quiet shift. All residents stable.", handoverNotes: "Watch Room 312 BP." },
      { staffId: nurse.id, userId: nurseUser.id, shiftType: "AFTERNOON", date: new Date(), summary: "PT sessions completed. One fall alert resolved.", handoverNotes: "Room 305 needs supervision overnight." },
    ]);
  }

  await seedIfEmpty("room", () => [
    { roomNumber: "101", floor: 1, wing: "East", roomType: "PRIVATE", capacity: 1, status: "AVAILABLE", features: "Wheelchair accessible, Call system", rateMonthly: 4200 },
    { roomNumber: "102", floor: 1, wing: "East", roomType: "SEMI_PRIVATE", capacity: 2, status: "OCCUPIED", features: "Shared bath, Window view", rateMonthly: 3200 },
    { roomNumber: "103", floor: 1, wing: "West", roomType: "PRIVATE", capacity: 1, status: "MAINTENANCE", features: "AC, Private bath", rateMonthly: 4500, notes: "Paint scheduled" },
    { roomNumber: "201", floor: 2, wing: "East", roomType: "PRIVATE", capacity: 1, status: "OCCUPIED", features: "Balcony, AC", rateMonthly: 4800 },
    { roomNumber: "202", floor: 2, wing: "East", roomType: "SEMI_PRIVATE", capacity: 2, status: "OCCUPIED", features: "Shared bath", rateMonthly: 3400 },
    { roomNumber: "203", floor: 2, wing: "West", roomType: "SUITE", capacity: 1, status: "RESERVED", features: "Living room, Kitchenette, Balcony", rateMonthly: 6500 },
    { roomNumber: "301", floor: 3, wing: "West", roomType: "PRIVATE", capacity: 1, status: "AVAILABLE", features: "Garden view, AC", rateMonthly: 4600 },
    { roomNumber: "302", floor: 3, wing: "West", roomType: "PRIVATE", capacity: 1, status: "OCCUPIED", features: "AC, Call system", rateMonthly: 4600 },
    { roomNumber: "305", floor: 3, wing: "West", roomType: "PRIVATE", capacity: 1, status: "OCCUPIED", features: "AC, Window view", rateMonthly: 4600 },
    { roomNumber: "308", floor: 3, wing: "East", roomType: "SEMI_PRIVATE", capacity: 2, status: "OCCUPIED", features: "Shared bath", rateMonthly: 3400 },
    { roomNumber: "310", floor: 3, wing: "East", roomType: "PRIVATE", capacity: 1, status: "OCCUPIED", features: "AC, Private bath", rateMonthly: 4800 },
    { roomNumber: "312", floor: 3, wing: "East", roomType: "PRIVATE", capacity: 1, status: "OCCUPIED", features: "AC, Emergency call", rateMonthly: 4800 },
  ]);

  await seedIfEmpty("inventoryItem", () => [
    { itemName: "Nitrile Gloves (Box)", category: "PPE", quantity: 240, unit: "boxes", minimumStock: 50, location: "Storage A", supplier: "MedSupply Co.", expiryDate: daysAgo(-365) },
    { itemName: "Face Masks (Box)", category: "PPE", quantity: 120, unit: "boxes", minimumStock: 30, location: "Storage A", supplier: "MedSupply Co.", expiryDate: daysAgo(-180) },
    { itemName: "Hand Sanitizer", category: "CLEANING", quantity: 48, unit: "bottles", minimumStock: 20, location: "Storage B", supplier: "CleanPro Ltd." },
    { itemName: "Adult Diapers (Large)", category: "PERSONAL_CARE", quantity: 200, unit: "pcs", minimumStock: 50, location: "Storage C", supplier: "CarePlus Inc." },
    { itemName: "Disposable Bed Sheets", category: "LINEN", quantity: 300, unit: "pcs", minimumStock: 100, location: "Storage B", supplier: "LinensDirect" },
    { itemName: "Blood Pressure Cuffs", category: "MEDICAL_SUPPLIES", quantity: 15, unit: "pcs", minimumStock: 10, location: "Equipment Room", supplier: "MedSupply Co." },
    { itemName: "Wheelchair", category: "EQUIPMENT", quantity: 8, unit: "pcs", minimumStock: 5, location: "Equipment Room", supplier: "MobilityPlus" },
    { itemName: "Disposable Cups", category: "FOOD", quantity: 500, unit: "pcs", minimumStock: 200, location: "Kitchen", supplier: "Restaurant Supply" },
    { itemName: "Antiseptic Wipes", category: "CLEANING", quantity: 80, unit: "containers", minimumStock: 25, location: "Storage A", supplier: "CleanPro Ltd.", expiryDate: daysAgo(-200) },
    { itemName: "Overbed Tables", category: "FURNITURE", quantity: 12, unit: "pcs", minimumStock: 5, location: "Furniture Storage", supplier: "FurniturePlus" },
  ]);

  await seedIfEmpty("admission", () => [
    {
      firstName: "Dorothy", lastName: "Hale", dateOfBirth: daysAgo(81 * 365), gender: "Female",
      phone: "555-0311", email: "family.hale@example.com", emergencyContact: "Grace Hale", emergencyContactPhone: "555-0312",
      medicalAssessment: "Mild hypertension; independent ADLs.", allergies: "None known", medicalHistory: "Hypertension",
      careAssessment: "Needs medication reminders.", careLevel: "ASSISTED", mobility: "Walker",
      insuranceProvider: "Medicare", insurancePolicyNumber: "MED-88213", insuranceVerified: true, insuranceVerifiedAt: daysAgo(2),
      roomNumber: "314", qrPayload: "GH-RES-DOROTHY",
      careTeam: JSON.stringify([{ id: "n1", name: "Sarah Jenkins", role: "Head Nurse" }]),
      carePlan: "Daily BP checks, medication reminders, social activities.", carePlanGoals: "Maintain independence; stable BP.",
      currentStep: 8, completedSteps: "[1,2,3,4,5,6,7]", status: "IN_PROGRESS",
    },
    {
      firstName: "Frank", lastName: "Osei", dateOfBirth: daysAgo(74 * 365), gender: "Male",
      phone: "555-0321", email: "osei.family@example.com",
      currentStep: 2, completedSteps: "[1]", status: "IN_PROGRESS",
    },
  ]);

  await seedIfEmpty("blogPost", () => [
    {
      title: "Opening Golden Hearth: A New Era of Premium Wellness",
      description: "We are thrilled to officially open our doors in BGC, Manila, offering a unique blend of organic modern design and state-of-the-art care.",
      content: "At Golden Hearth, our philosophy centers on redefining elder care. By pairing a luxurious, sanctuary-like residential design with cutting-edge optical safety networks and compassionate staff, we ensure that every resident experiences a higher quality of life. From chef-inspired organic dining to curated wellness programs, our doors are open for residents looking for peaceful, high-end care.",
      imageUrl: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?q=80&w=1000",
      author: "System Admin",
      publishedAt: daysAgo(5),
      published: true
    },
    {
      title: "Designing for Comfort: The Power of Organic Architecture",
      description: "How our double-height lounge, therapeutic walking gardens, and private suites promote active recovery and mental well-being.",
      content: "Studies show that connection to nature and natural sunlight significantly reduces stress levels and improves cardiovascular health in older adults. That is why Golden Hearth features floor-to-ceiling atrium windows looking onto private Japanese rock gardens. Our residence has been carefully designed down to the smallest detail, ensuring accessibility without compromising on premium, organic aesthetics.",
      imageUrl: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=1000",
      author: "Sarah Jenkins",
      publishedAt: daysAgo(3),
      published: true
    },
    {
      title: "AI & Assisted Living: Safety Without Compromising Privacy",
      description: "Exploring the non-intrusive Optical Safety Matrices that detect anomalies and alert nursing staff instantly.",
      content: "Safety is our paramount concern, but it should never come at the cost of a resident's dignity. Our suite protection system uses non-intrusive optical safety sensors that detect posture anomalies and fall triggers in real-time. By computing data at the edge and never recording video streams, residents maintain 100% privacy while caregivers receive instant warning alerts within seconds of any safety incident.",
      imageUrl: "https://images.unsplash.com/photo-1576091160550-2173dba999ef?q=80&w=1000",
      author: "Caleb Randall",
      publishedAt: daysAgo(1),
      published: true
    }
  ]);

  // ── Phase 6: Fleet & Transport ─────────────────────────────────────────────
  const hoursFromNow = (n) => new Date(Date.now() + n * 3600 * 1000);

  await seedIfEmpty("vehicle", () => [
    { name: "Shuttle One", licensePlate: "SH-001", type: "SHUTTLE", status: "AVAILABLE", make: "Toyota", model: "Hiace GL", year: 2023, vin: "JTFHS02P500012345", capacity: 12, wheelchairCapacity: 0, odometer: 48230, fuelLevel: 82, insuranceProvider: "Malayan Insurance", insurancePolicyNumber: "MI-4821-FLT", insuranceExpiry: inDays(160), registrationExpiry: inDays(210), lastServiceDate: daysAgo(40), nextServiceDate: inDays(50), nextServiceOdometer: 53000, gpsDeviceId: "GPS-SH1" },
    { name: "Wheelchair Van", licensePlate: "WV-001", type: "WHEELCHAIR_VAN", status: "AVAILABLE", make: "Ford", model: "Transit 350", year: 2022, vin: "1FTBW2CM6NKA23456", capacity: 6, wheelchairCapacity: 2, odometer: 61540, fuelLevel: 58, insuranceProvider: "Pioneer Insurance", insurancePolicyNumber: "PI-7734-FLT", insuranceExpiry: inDays(300), registrationExpiry: inDays(14), lastServiceDate: daysAgo(25), nextServiceDate: inDays(65), nextServiceOdometer: 66000, gpsDeviceId: "GPS-WV1", notes: "Lift inspected monthly." },
    { name: "Ambulance Unit", licensePlate: "AMB-001", type: "AMBULANCE", status: "AVAILABLE", make: "Mercedes-Benz", model: "Sprinter 519", year: 2024, vin: "WDAPF4CC5N9723456", capacity: 3, wheelchairCapacity: 1, odometer: 21870, fuelLevel: 95, insuranceProvider: "Malayan Insurance", insurancePolicyNumber: "MI-9010-EMS", insuranceExpiry: inDays(25), registrationExpiry: inDays(320), lastServiceDate: daysAgo(15), nextServiceDate: inDays(75), nextServiceOdometer: 26000, gpsDeviceId: "GPS-AMB1", notes: "Stocked per EMS checklist." },
    { name: "Sedan Escort", licensePlate: "SD-001", type: "SEDAN", status: "MAINTENANCE", make: "Toyota", model: "Camry", year: 2021, vin: "4T1BF1FK5MU123456", capacity: 4, wheelchairCapacity: 0, odometer: 88410, fuelLevel: 34, insuranceProvider: "Pioneer Insurance", insurancePolicyNumber: "PI-2210-FLT", insuranceExpiry: inDays(95), registrationExpiry: inDays(120), lastServiceDate: daysAgo(90), nextServiceDate: daysAgo(5), nextServiceOdometer: 88000, notes: "Brake pads replacement in progress." },
  ]);

  await seedIfEmpty("driver", () => [
    { name: "James Miguel", phone: "555-0401", email: "james.miguel@goldenhearth.com", licenseNumber: "DLN-99882", licenseClass: "Professional B", licenseExpiry: inDays(400), certifications: "Wheelchair Transport, First Aid, Defensive Driving", certificationExpiry: inDays(180), safetyScore: 96, tripHours: 412.5, isActive: true, hireDate: daysAgo(900) },
    { name: "Rosa Santos", phone: "555-0402", email: "rosa.santos@goldenhearth.com", licenseNumber: "DLN-99883", licenseClass: "Professional B", licenseExpiry: inDays(21), certifications: "Ambulance Operations, BLS, First Aid", certificationExpiry: inDays(90), safetyScore: 88, tripHours: 268.0, isActive: true, hireDate: daysAgo(600), notes: "License renewal filed." },
    { name: "Eddie Ramos", phone: "555-0403", email: "eddie.ramos@goldenhearth.com", licenseNumber: "DLN-99884", licenseClass: "Non-Professional", licenseExpiry: inDays(700), certifications: "Defensive Driving", safetyScore: 71, tripHours: 96.5, isActive: false, hireDate: daysAgo(300), notes: "On leave; retraining scheduled." },
  ]);

  // Resolve fleet ids for relation seeding (works on fresh AND re-run seeds).
  const vehByPlate = {};
  for (const v of await prisma.vehicle.findMany()) vehByPlate[v.licensePlate] = v;
  const drvByLicense = {};
  for (const d of await prisma.driver.findMany()) drvByLicense[d.licenseNumber] = d;
  const shuttle = vehByPlate["SH-001"];
  const wcVan = vehByPlate["WV-001"];
  const ambulance = vehByPlate["AMB-001"];
  const sedan = vehByPlate["SD-001"];
  const drvJames = drvByLicense["DLN-99882"];
  const drvRosa = drvByLicense["DLN-99883"];

  if (shuttle && wcVan && ambulance && drvJames && drvRosa) {
    const FAC = "Golden Hearth Facility";
    await seedIfEmpty("transportRequest", () => [
      { residentId: R["302"].id, type: "MEDICAL_APPOINTMENT", pickupLocation: FAC, dropoffLocation: "St. Luke's Medical Center", destination: "St. Luke's Medical Center", purpose: "Endocrinology consult — diabetes review", requestedDate: hoursFromNow(24), returnRequired: true, escortRequired: true, escortRole: "NURSE", priority: "NORMAL", status: "PENDING", source: "PORTAL", notes: "Family requests morning slot." },
      { residentId: R["302"].id, type: "DIALYSIS", pickupLocation: FAC, dropoffLocation: "St. Luke's Dialysis Center", destination: "St. Luke's Dialysis Center", purpose: "Recurring dialysis run", requestedDate: hoursAgo(1), returnRequired: true, wheelchairNeeded: true, escortRequired: true, escortRole: "NURSE", priority: "HIGH", status: "SCHEDULED", source: "FRONT_DESK", reviewedBy: "Dispatcher", reviewedAt: daysAgo(1) },
      { residentId: R["310"].id, type: "MEDICAL_APPOINTMENT", pickupLocation: FAC, dropoffLocation: "Makati Medical Center", destination: "Makati Medical Center", purpose: "Cardiology follow-up", requestedDate: hoursFromNow(4), returnRequired: true, priority: "NORMAL", status: "SCHEDULED", source: "AI_COMPANION", reviewedBy: "Dispatcher", reviewedAt: daysAgo(2) },
      { residentId: R["308"].id, type: "THERAPY", pickupLocation: FAC, dropoffLocation: "Rehab Partners PT Clinic", destination: "Rehab Partners PT Clinic", purpose: "Post-surgery physical therapy", requestedDate: hoursFromNow(48), returnRequired: true, escortRequired: true, escortRole: "CAREGIVER", priority: "NORMAL", status: "APPROVED", source: "PORTAL", reviewedBy: "Dispatcher", reviewedAt: hoursAgo(5) },
      { residentId: R["305"].id, type: "FAMILY_OUTING", pickupLocation: FAC, dropoffLocation: "SM Mall of Asia", destination: "SM Mall of Asia", purpose: "Family lunch", requestedDate: hoursFromNow(120), returnRequired: true, escortRequired: true, escortRole: "CAREGIVER", priority: "LOW", status: "DECLINED", source: "PORTAL", reviewedBy: "Dispatcher", reviewedAt: daysAgo(1), declineReason: "No caregiver escort available that afternoon; please rebook." },
      { residentId: R["312"].id, type: "EMERGENCY_TRANSFER", pickupLocation: "Philippine Heart Center — ER", dropoffLocation: FAC, destination: FAC, purpose: "Stabilized — return to facility", requestedDate: hoursFromNow(2), returnRequired: false, wheelchairNeeded: true, priority: "HIGH", status: "APPROVED", source: "DRIVER", reviewedBy: "Dispatcher", reviewedAt: hoursAgo(1), notes: "Ambulance return leg (hospital → facility)." },
    ]);

    // Link the dialysis request to its live trip + build the rest of the log.
    const dialysisReq = await prisma.transportRequest.findFirst({ where: { type: "DIALYSIS", residentId: R["302"].id } });
    const cardioReq = await prisma.transportRequest.findFirst({ where: { destination: "Makati Medical Center", residentId: R["310"].id } });

    const CHECKLIST = JSON.stringify([{ item: "Tires & wheels", ok: true }, { item: "Brakes", ok: true }, { item: "Lights & signals", ok: true }, { item: "Fuel level", ok: true }, { item: "Wheelchair lift & securement", ok: true }, { item: "Seatbelts & restraints", ok: true }, { item: "First-aid kit & O2", ok: true }, { item: "Interior sanitized", ok: true }]);
    await seedIfEmpty("trip", () => [
      { requestId: dialysisReq?.id ?? null, residentId: R["302"].id, vehicleId: wcVan.id, driverId: drvJames.id, escortName: "Sarah Jenkins", escortRole: "NURSE", status: "EN_ROUTE", pickupLocation: FAC, dropoffLocation: "St. Luke's Dialysis Center", origin: FAC, destination: "St. Luke's Dialysis Center", scheduledAt: hoursAgo(1), departedAt: hoursAgo(0.4), distanceKm: 12.5, currentLat: 14.5591, currentLng: 121.0312, lastPingAt: new Date(), inspectionDone: true, inspectionChecklist: CHECKLIST, familyNotified: true, charge: 60, notes: "Dialysis run — recurring Tue/Thu/Sat." },
      { requestId: cardioReq?.id ?? null, residentId: R["310"].id, vehicleId: shuttle.id, driverId: drvRosa.id, status: "SCHEDULED", pickupLocation: FAC, dropoffLocation: "Makati Medical Center", origin: FAC, destination: "Makati Medical Center", scheduledAt: hoursFromNow(4), distanceKm: 9.8, charge: 75, notes: "Cardiology follow-up." },
      { residentId: R["305"].id, vehicleId: shuttle.id, driverId: drvJames.id, escortName: "Caleb Randall", escortRole: "CAREGIVER", status: "COMPLETED", pickupLocation: FAC, dropoffLocation: "Luneta Park — Family Outing", origin: FAC, destination: "Luneta Park — Family Outing", scheduledAt: daysAgo(3), departedAt: daysAgo(3), arrivedAt: daysAgo(3), returnDepartedAt: daysAgo(3), completedAt: daysAgo(3), distanceKm: 18.2, inspectionDone: true, familyNotified: true, billed: true, charge: 50 },
      { residentId: R["312"].id, vehicleId: ambulance.id, driverId: drvRosa.id, escortName: "Rebecca Wilson", escortRole: "NURSE", status: "COMPLETED", pickupLocation: FAC, dropoffLocation: "Philippine Heart Center — ER", origin: FAC, destination: "Philippine Heart Center — ER", scheduledAt: daysAgo(6), departedAt: daysAgo(6), arrivedAt: daysAgo(6), completedAt: daysAgo(6), distanceKm: 14.6, inspectionDone: true, familyNotified: true, billed: true, charge: 250, notes: "EMERGENCY transfer — AFib episode, stabilized." },
      // Extra trips for the active driver (James) so every driver module is populated.
      { residentId: R["308"].id, vehicleId: shuttle.id, driverId: drvJames.id, escortName: "Caleb Randall", escortRole: "CAREGIVER", status: "SCHEDULED", pickupLocation: FAC, dropoffLocation: "Rehab Partners PT Clinic", origin: FAC, destination: "Rehab Partners PT Clinic", scheduledAt: hoursFromNow(6), distanceKm: 7.4, charge: 55, notes: "Post-surgery physical therapy." },
      { residentId: R["302"].id, vehicleId: wcVan.id, driverId: drvJames.id, escortName: "Sarah Jenkins", escortRole: "NURSE", status: "INSPECTION", pickupLocation: FAC, dropoffLocation: "St. Luke's Medical Center", origin: FAC, destination: "St. Luke's Medical Center", scheduledAt: hoursFromNow(1), distanceKm: 11.2, inspectionDone: false, inspectionChecklist: CHECKLIST, charge: 60, notes: "Endocrinology consult — pre-trip inspection." },
      { residentId: R["312"].id, vehicleId: ambulance.id, driverId: drvJames.id, escortName: "Rebecca Wilson", escortRole: "NURSE", status: "RETURNING", pickupLocation: "Philippine Heart Center — ER", dropoffLocation: FAC, origin: "Philippine Heart Center — ER", destination: FAC, scheduledAt: hoursAgo(3), departedAt: hoursAgo(2.5), arrivedAt: hoursAgo(1.5), returnDepartedAt: hoursAgo(0.5), distanceKm: 14.6, currentLat: 14.5760, currentLng: 121.0437, lastPingAt: new Date(), inspectionDone: true, inspectionChecklist: CHECKLIST, familyNotified: true, charge: 250, notes: "Ambulance return leg — hospital → facility." },
    ]);

    // Keep the wheelchair van marked ON_TRIP to match its live EN_ROUTE trip.
    await prisma.vehicle.update({ where: { id: wcVan.id }, data: { status: "ON_TRIP" } });

    await seedIfEmpty("vehicleMaintenance", () => [
      { vehicleId: sedan.id, type: "REPAIR", status: "IN_PROGRESS", title: "Brake pads & rotor replacement", description: "Grinding noise reported; front brakes worn.", scheduledDate: daysAgo(1), odometerAt: 88410, cost: 340, vendor: "AutoCare Garage Makati", downtimeHours: 26 },
      { vehicleId: shuttle.id, type: "PREVENTIVE", status: "SCHEDULED", title: "Preventive service — Shuttle One", description: "5,000 km interval: oil, filters, fluids, multi-point inspection.", scheduledDate: inDays(6), vendor: "Toyota Service Center" },
      { vehicleId: wcVan.id, type: "INSPECTION", status: "COMPLETED", title: "Wheelchair lift monthly inspection", description: "Hydraulics, securement straps, and safety interlocks.", scheduledDate: daysAgo(9), completedDate: daysAgo(8), odometerAt: 61210, cost: 85, vendor: "MobilityPlus Service", downtimeHours: 3, notes: "Passed. Next check in 30 days." },
      { vehicleId: ambulance.id, type: "PREVENTIVE", status: "COMPLETED", title: "Ambulance quarterly service", description: "Engine service + EMS equipment calibration.", scheduledDate: daysAgo(16), completedDate: daysAgo(15), odometerAt: 21400, cost: 520, vendor: "Mercedes-Benz Commercial", downtimeHours: 9 },
    ]);

    await seedIfEmpty("fuelLog", () => [
      { vehicleId: wcVan.id, driverId: drvJames.id, logDate: hoursAgo(12), odometer: 61540, liters: 42.3, cost: 2620, fuelType: "Diesel" },
      { vehicleId: shuttle.id, driverId: drvRosa.id, logDate: daysAgo(2), odometer: 48230, liters: 55.0, cost: 3410, fuelType: "Diesel" },
      { vehicleId: wcVan.id, driverId: drvJames.id, logDate: daysAgo(6), odometer: 61180, liters: 40.1, cost: 2480, fuelType: "Diesel" },
      { vehicleId: ambulance.id, driverId: drvRosa.id, logDate: daysAgo(8), odometer: 21870, liters: 48.6, cost: 3010, fuelType: "Diesel", notes: "Post-emergency refill." },
      { vehicleId: shuttle.id, driverId: drvJames.id, logDate: daysAgo(9), odometer: 47820, liters: 52.4, cost: 3250, fuelType: "Diesel" },
    ]);

    console.log("  • fleet: vehicles, drivers, requests, trips, maintenance, fuel logs ready");
  }

  // Seed dining/menu data
  await seedIfEmpty("dailyMenu", () => [
    { mealType: "BREAKFAST", name: "Oatmeal with Fresh Berries", description: "Warm organic rolled oats topped with fresh blueberries, strawberries, and a drizzle of honey.", dietaryTags: "Low Sodium,High Fiber", menuDate: new Date() },
    { mealType: "LUNCH", name: "Grilled Herb Salmon", description: "Wild-caught salmon fillet grilled with garlic herbs, served with asparagus and brown rice.", dietaryTags: "Diabetic Friendly,Low Sodium,High Protein", menuDate: new Date() },
    { mealType: "DINNER", name: "Roasted Turkey Breast", description: "Slices of tender roasted turkey breast with steamed broccoli and mashed sweet potatoes.", dietaryTags: "Low Fat,High Protein", menuDate: new Date() },
  ]);

  // Seed dietitian consults
  if (R["302"] && R["305"]) {
    await seedIfEmpty("dietitianConsult", () => [
      { residentId: R["302"].id, dietitianName: "Clara Vance, RD, LDN", reason: "Resident exhibits consistent elevated fasting blood glucose levels; requires carbohydrate-controlled meal alignment.", recommendations: "Limit simple carbohydrates. Restrict fruit juices. Focus on complex carbs with high fiber. Introduce a late-night high-protein snack.", status: "COMPLETED", consultDate: daysAgo(5) },
      { residentId: R["305"].id, dietitianName: "Clara Vance, RD, LDN", reason: "Difficulty chewing and swallowing dry meats during dinner service.", recommendations: "Recommend transitional mechanical soft diet or pureed meat dishes with broth/gravy to prevent choking hazard.", status: "PENDING", consultDate: daysAgo(2) }
    ]);
  }

  // Seed compliance logs
  await seedIfEmpty("foodComplianceLog", () => [
    { title: "Weekly HACCP Kitchen Inspection", category: "SANITATION", status: "COMPLIANT", score: 98, auditedBy: "Facility Admin", auditDate: daysAgo(4), details: "All stainless steel prep surfaces fully sanitized. Dishwasher temp reaching sanitizing threshold (82°C). Allergen separation protocols active." },
    { title: "Walk-in Cooler Thermostat Calibration Audit", category: "TEMPERATURE", status: "COMPLIANT", score: 100, auditedBy: "Facility Admin", auditDate: daysAgo(7), details: "Cooler temperature checked against master probe. Re-calibrated to steady 3.8°C. Dry storage humidity logged at 45%." }
  ]);

  // ── Phase 7 (cont.): Hotel-Style Resident Services & Maintenance ───────────

  await seedIfEmpty("serviceRequest", () => [
    { residentId: R["302"].id, roomNumber: "302", category: "AIRCON_HVAC", subType: "Temp Adjust", details: "Room feels warm in the afternoon — please lower to 22°C.", source: "RESIDENT_PORTAL", priority: "ROUTINE", status: "IN_PROGRESS", assignedTeam: "MAINTENANCE_ENGINEER", assignedTo: "Ben Alvarez", startedAt: hoursAgo(1) },
    { residentId: R["302"].id, roomNumber: "302", category: "HOUSEKEEPING", subType: "Linen Change", details: "Fresh linens please, plus towel restock.", source: "AI_COMPANION", priority: "ROUTINE", status: "COMPLETED", assignedTeam: "HOUSEKEEPING_TEAM", assignedTo: "Lena Cruz", startedAt: hoursAgo(7), completedAt: hoursAgo(5), photoProofUrl: "https://images.unsplash.com/photo-1584132967334-10e028bd69f7?q=80&w=600" },
    { residentId: R["305"].id, roomNumber: "305", category: "ROOM_SERVICE", subType: "Meals", details: "Mechanical-soft dinner tray to the room tonight.", source: "CALL_BELL", priority: "URGENT", status: "ASSIGNED", assignedTeam: "KITCHEN", billable: true, charge: 18, notes: "Dietitian-approved menu only." },
    { residentId: R["312"].id, roomNumber: "312", category: "REPAIRS", subType: "Wi-Fi/TV", details: "TV remote unresponsive and Wi-Fi drops in the evening.", source: "FRONT_DESK", priority: "ROUTINE", status: "OPEN", assignedTeam: "IT_SUPPORT" },
    { residentId: R["310"].id, roomNumber: "310", category: "LAUNDRY", subType: "Laundry & Pressing", details: "Two barongs pressed for Sunday visit.", source: "RESIDENT_PORTAL", priority: "ROUTINE", status: "CONFIRMED", assignedTeam: "HOUSEKEEPING_TEAM", assignedTo: "Lena Cruz", startedAt: daysAgo(2), completedAt: daysAgo(2), confirmedAt: daysAgo(1), rating: 5, ratingComment: "Crisp and on time — thank you!", billable: true, charge: 12, billed: true, photoProofUrl: "https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?q=80&w=600" },
    { residentId: R["312"].id, roomNumber: "312", category: "REPAIRS", subType: "Plumbing", details: "Bathroom sink draining slowly — water pooling.", source: "CALL_BELL", priority: "EMERGENCY", status: "COMPLETED", assignedTeam: "MAINTENANCE_ENGINEER", assignedTo: "Ben Alvarez", startedAt: daysAgo(1), completedAt: daysAgo(1), photoProofUrl: "https://images.unsplash.com/photo-1585704032915-c3400ca199e7?q=80&w=600", notes: "Trap cleared; resealed." },
  ]);

  await seedIfEmpty("facilityMaintenance", () => [
    { title: "HVAC Quarterly Service — East Wing", system: "HVAC", type: "PREVENTIVE", status: "SCHEDULED", frequency: "QUARTERLY", location: "East Wing rooftop plant", description: "Coil cleaning, refrigerant check, filter replacement across AHUs 1–4.", scheduledDate: inDays(6), nextDueDate: inDays(6), assignedTo: "Ben Alvarez", vendor: "CoolAir Services PH" },
    { title: "Generator Monthly Load Test", system: "GENERATOR", type: "INSPECTION", status: "SCHEDULED", frequency: "MONTHLY", location: "Power house", description: "30-minute full-load test, fuel level and transfer-switch verification.", scheduledDate: inDays(2), nextDueDate: inDays(2), assignedTo: "Facilities Team", notes: "Log run-hours after test." },
    { title: "Elevator Annual Certification Inspection", system: "ELEVATOR", type: "INSPECTION", status: "IN_PROGRESS", frequency: "ANNUAL", location: "Lift bank A & B", description: "Third-party safety certification: brakes, cables, leveling, door sensors.", scheduledDate: daysAgo(1), nextDueDate: daysAgo(1), vendor: "OtisPro Inspections", cost: 950 },
    { title: "Fire & Safety Systems Check", system: "FIRE_SAFETY", type: "PREVENTIVE", status: "COMPLETED", frequency: "QUARTERLY", location: "All floors", description: "Sprinklers, smoke detectors, extinguishers, alarm panel & pull stations.", scheduledDate: daysAgo(12), completedDate: daysAgo(11), nextDueDate: inDays(79), assignedTo: "Facilities Team", vendor: "SafeGuard Fire Systems", cost: 620, notes: "2 extinguishers recharged." },
    { title: "Pest Control Treatment — Kitchen & Storage", system: "PEST_CONTROL", type: "PREVENTIVE", status: "COMPLETED", frequency: "MONTHLY", location: "Kitchen, dry storage, waste area", description: "Gel bait rotation + perimeter treatment; food-safe products only.", scheduledDate: daysAgo(20), completedDate: daysAgo(19), nextDueDate: inDays(11), vendor: "EcoPest Manila", cost: 180 },
  ]);

  await seedIfEmpty("conciergeBooking", () => [
    { residentId: R["302"].id, category: "WAKE_UP_CALL", serviceName: "Wake-Up & Reminder Calls", scheduledAt: inDays(1), status: "CONFIRMED", staffName: "Front Desk", location: "Room 302", price: 0, billable: false, notes: "6:30 AM daily — medication reminder included." },
    { residentId: R["302"].id, category: "SALON_BARBER", serviceName: "Salon & Barber", scheduledAt: inDays(2), status: "REQUESTED", location: "Wellness Salon, G/F", price: 25, billable: true, notes: "Haircut before Sunday family visit." },
    { residentId: R["305"].id, category: "SPA_MASSAGE", serviceName: "Massage & Spa Therapy", scheduledAt: daysAgo(1), status: "COMPLETED", staffName: "Wellness Team", location: "Spa Suite", price: 45, billable: true, billed: true, rating: 5, notes: "Gentle mobility massage." },
    { residentId: R["310"].id, category: "GUEST_SUITE", serviceName: "Guest Suite for Family Stay", scheduledAt: inDays(5), status: "CONFIRMED", staffName: "Concierge Desk", location: "Guest Suite 2, 2/F", price: 120, billable: true, notes: "Two nights — daughter visiting from Cebu." },
    { residentId: R["308"].id, category: "CHAPLAIN", serviceName: "Chaplain / Spiritual Care Visit", scheduledAt: inDays(1), status: "CONFIRMED", staffName: "Fr. Del Rosario", location: "Garden Lounge", price: 0, billable: false },
    { residentId: R["305"].id, category: "MOVIE_GAME_NIGHT", serviceName: "Movie & Game Nights", scheduledAt: inDays(3), status: "REQUESTED", location: "Activity Hall", price: 0, billable: false, notes: "Classic film night reservation." },
  ]);

  console.log("  • phase 7: service requests, facility maintenance calendar, concierge bookings ready");

  // ── Phase 7 PMS: Hospitality & Property Management System ───────────────────

  // Housekeeping lifecycle status on existing rooms (mobile staff tools).
  const roomHousekeeping = {
    "103": "DEEP_CLEAN", "203": "INSPECTION", "301": "READY",
    "302": "OCCUPIED", "305": "OCCUPIED", "308": "MOVE_OUT",
    "310": "OCCUPIED", "312": "OCCUPIED",
  };
  for (const [rn, hk] of Object.entries(roomHousekeeping)) {
    await prisma.room.updateMany({ where: { roomNumber: rn }, data: { housekeepingStatus: hk } });
  }

  await seedIfEmpty("frontDeskVisit", () => [
    { visitType: "GUEST_VISIT", status: "CHECKED_IN", visitorName: "John Pendelton", visitorPhone: "555-0200", idType: "Driver's License", idNumber: "N01-88-123456", visitorPass: "VP-0417", residentId: R["302"].id, roomNumber: "302", purpose: "Sunday family visit", arrivalTime: hoursAgo(1.5), checkInTime: hoursAgo(1.4), ancillaryItems: JSON.stringify([{ label: "Guest lunch (2)", amount: 24 }]), ancillaryTotal: 24 },
    { visitType: "NEW_RESIDENT_ARRIVAL", status: "ARRIVED", visitorName: "Dorothy Hale", visitorPhone: "555-0311", idType: "Passport", idNumber: "P1234567A", roomNumber: "314", purpose: "Move-in — Room 314", arrivalTime: hoursAgo(0.5), notes: "Admission step 8 pending room allocation." },
    { visitType: "TOUR", status: "CHECKED_OUT", visitorName: "Grace & Michael Tan", visitorPhone: "555-0620", idType: "Driver's License", idNumber: "N02-77-998877", visitorPass: "VP-0416", purpose: "Prospective resident tour", arrivalTime: daysAgo(1), checkInTime: daysAgo(1), checkOutTime: hoursAgo(25.5), receiptNumber: "RCPT-2207", notes: "Interested in a suite for their mother." },
    { visitType: "GUEST_VISIT", status: "CHECKED_OUT", visitorName: "Rosa Chen", visitorPhone: "555-0512", idType: "UMID", idNumber: "CRN-0111-2222", visitorPass: "VP-0410", residentId: R["310"].id, roomNumber: "310", purpose: "Afternoon visit + salon treat", arrivalTime: daysAgo(2), checkInTime: daysAgo(2), checkOutTime: hoursAgo(46), ancillaryItems: JSON.stringify([{ label: "Salon — haircut", amount: 25 }, { label: "Café drinks", amount: 8 }]), ancillaryTotal: 33, receiptNumber: "RCPT-2201" },
  ]);

  await seedIfEmpty("roomTurnover", () => [
    { roomNumber: "103", stage: "DEEP_CLEAN", status: "IN_PROGRESS", outgoingResident: "Prior resident", assignedTo: "Lena Cruz", checklist: JSON.stringify([{ item: "Strip & launder linens", ok: true }, { item: "Deep clean bathroom", ok: true }, { item: "Sanitize surfaces", ok: false }, { item: "Restock amenities", ok: false }]), startedAt: hoursAgo(6), notes: "Repaint scheduled after deep clean." },
    { roomNumber: "203", stage: "INSPECTION", status: "IN_PROGRESS", incomingResident: "Dorothy Hale", assignedTo: "Ben Alvarez", checklist: JSON.stringify([{ item: "Make ready", ok: true }, { item: "HVAC check", ok: true }, { item: "Final inspection", ok: false }]), startedAt: daysAgo(1), notes: "Suite prepped for incoming resident." },
    { roomNumber: "301", stage: "READY", status: "COMPLETED", outgoingResident: "Prior resident", assignedTo: "Lena Cruz", inspectionPassed: true, startedAt: daysAgo(3), readyAt: hoursAgo(52), notes: "Turnover completed in ~20h." },
    { roomNumber: "308", stage: "MOVE_OUT", status: "IN_PROGRESS", outgoingResident: "James Murphy (transfer)", startedAt: hoursAgo(3), notes: "Transfer to skilled-nursing wing." },
  ]);

  await seedIfEmpty("residentPreference", () => [
    { residentId: R["302"].id, category: "Room Comfort", preference: "Preferred room temperature", value: "22°C", notes: "Feels warm in the afternoon." },
    { residentId: R["302"].id, category: "Wake-Up", preference: "Preferred wake-up time", value: "6:30 AM", notes: "With medication reminder." },
    { residentId: R["302"].id, category: "Dining", preference: "Dietary preference", value: "Low-sodium, diabetic-friendly" },
    { residentId: R["302"].id, category: "Activities", preference: "Favorite activities", value: "Garden walks, chess, classic films" },
    { residentId: R["302"].id, category: "Communication", preference: "Preferred contact", value: "Notify son (John) for updates" },
    { residentId: R["305"].id, category: "Dining", preference: "Texture", value: "Mechanical-soft meals" },
  ]);

  await seedIfEmpty("communityEvent", () => [
    { title: "Sunday Garden Concert", category: "SOCIAL", description: "Live acoustic music in the therapeutic garden with afternoon tea.", location: "Garden Lounge", startTime: inDays(3), endTime: inDays(3), capacity: 40, host: "Activities Team", imageUrl: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?q=80&w=800", published: true },
    { title: "Chair Yoga & Wellness", category: "WELLNESS", description: "Gentle guided chair yoga for mobility and relaxation.", location: "Activity Hall", startTime: inDays(1), endTime: inDays(1), capacity: 20, host: "Wellness Team", imageUrl: "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?q=80&w=800", published: true },
    { title: "Classic Movie Night — Casablanca", category: "RECREATION", description: "Cinema evening with popcorn and refreshments.", location: "Activity Hall", startTime: inDays(2), endTime: inDays(2), capacity: 50, host: "Activities Team", imageUrl: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=800", published: true },
    { title: "Sunday Chapel Service", category: "SPIRITUAL", description: "Interfaith spiritual care service with Fr. Del Rosario.", location: "Chapel", startTime: inDays(3), endTime: inDays(3), host: "Chaplaincy", published: true },
  ]);

  const evConcert = await prisma.communityEvent.findFirst({ where: { title: "Sunday Garden Concert" } });
  const evYoga = await prisma.communityEvent.findFirst({ where: { title: "Chair Yoga & Wellness" } });
  const evMovie = await prisma.communityEvent.findFirst({ where: { title: "Classic Movie Night — Casablanca" } });
  if (evConcert && evYoga && evMovie) {
    await seedIfEmpty("eventAttendance", () => [
      { eventId: evConcert.id, residentId: R["302"].id, status: "GOING" },
      { eventId: evYoga.id, residentId: R["302"].id, status: "ATTENDED", checkedInAt: hoursAgo(20), rating: 5, notes: "Loved it." },
      { eventId: evMovie.id, residentId: R["305"].id, status: "ATTENDED", checkedInAt: hoursAgo(30), rating: 4 },
    ]);
  }

  await seedIfEmpty("diningReservation", () => [
    { residentId: R["302"].id, mealType: "DINNER", reservedAt: hoursFromNow(4), partySize: 3, venue: "Main Dining", status: "CONFIRMED", guestNames: "John Pendelton + 1 guest", specialRequests: "Window table; low-sodium meal for Arthur." },
    { residentId: R["310"].id, mealType: "LUNCH", reservedAt: hoursAgo(24), partySize: 1, venue: "Bistro", status: "COMPLETED" },
    { residentId: R["305"].id, mealType: "DINNER", reservedAt: hoursFromNow(6), partySize: 2, venue: "Private Room", status: "REQUESTED", guestNames: "Daughter visiting", specialRequests: "Pureed/mechanical-soft option." },
  ]);

  await seedIfEmpty("announcement", () => [
    { title: "Elevator Maintenance — Lift B", body: "Lift B will undergo its annual safety certification this week. Please use Lift A. We apologize for any inconvenience.", audience: "ALL", priority: "HIGH", authorName: "Facility Admin", pinned: true, published: true, autoNotify: false, publishedAt: hoursAgo(4) },
    { title: "Sunday Garden Concert This Weekend", body: "Join us in the Garden Lounge this Sunday afternoon for live acoustic music and afternoon tea. Families welcome!", audience: "RESIDENTS", priority: "NORMAL", authorName: "Activities Team", published: true, autoNotify: false, publishedAt: daysAgo(1) },
    { title: "Flu Vaccination Clinic — Next Tuesday", body: "The on-site clinic will offer seasonal flu vaccinations next Tuesday from 9 AM to 12 PM. Please sign up at the front desk.", audience: "ALL", priority: "NORMAL", authorName: "Head Nurse", published: true, autoNotify: false, publishedAt: daysAgo(2) },
  ]);

  console.log("  • phase 7 PMS: front desk, room turnovers, preferences, community events, dining, announcements ready");

  // ── Physician portal demo: care directives, notes to co-sign, consults ─────
  if (R["302"] && R["305"] && R["312"]) {
    await seedIfEmpty("residentGoal", () => [
      { residentId: R["302"].id, title: "Ambulate 15 min twice daily", description: "Supervised walks morning and afternoon to improve mobility.", isCustom: true },
      { residentId: R["302"].id, title: "Fasting glucose < 130 mg/dL", description: "Diabetic diet adherence; recheck fasting glucose weekly.", isCustom: true },
      { residentId: R["305"].id, title: "Reorientation routine 3x daily", description: "Memory-care reorientation with calendar and familiar photos.", isCustom: true },
      { residentId: R["312"].id, title: "BP target < 140/90", description: "Monitor BP each shift; report readings > 160 systolic.", isCustom: true },
    ]);

    await seedIfEmpty("medicalNote", () => [
      { residentId: R["302"].id, title: "Evening clinical note", content: "Resident stable. Ate well, ambulated with walker. No distress.", noteType: "CLINICAL_NOTE", authorName: "Sarah Jenkins, RN" },
      { residentId: R["305"].id, title: "Behavioral observation", content: "Mild sundowning after 6 PM; redirection effective.", noteType: "PROGRESS_NOTE", authorName: "Caleb Randall" },
      { residentId: R["302"].id, title: "Stage 2 hypertension — regimen review", content: "ASSESSMENT: BP trending high on current dose.\nPLAN: increase lisinopril; recheck in 1 week.", noteType: "DIAGNOSIS", authorName: "Dr. Alan Reyes" },
      { residentId: R["312"].id, title: "Cardiology referral — AFib workup", content: "Recurrent palpitations; request cardiology evaluation and Holter monitor.", noteType: "REFERRAL", authorName: "Dr. Alan Reyes" },
      { residentId: R["305"].id, title: "Consult: swallowing assessment", content: "Nurse reports intermittent coughing with meals — please advise on SLP consult.", noteType: "CONSULTATION", authorName: "Sarah Jenkins, RN" },
    ]);

    // Ensure a PENDING order exists for the physician approval queue.
    const pendingCount = await prisma.medication.count({ where: { status: "PENDING" } });
    if (pendingCount === 0) {
      await prisma.medication.create({ data: {
        residentId: R["312"].id, name: "Apixaban", dosage: "5mg", frequency: "Twice daily", route: "oral",
        status: "PENDING", startDate: new Date(), reason: "AFib anticoagulation — awaiting physician approval",
      } });
      console.log("  • physician: seeded 1 pending order for approval queue");
    }
    console.log("  • physician: care directives, notes to co-sign, consults ready");
  }

  // ── SBAR clinical escalations ───────────────────────────────────────────────
  if (R["302"] && R["305"] && R["312"]) {
    const minsAgo = (n) => new Date(Date.now() - n * 60000);
    await seedIfEmpty("escalation", () => [
      { residentId: R["312"].id, situation: "SpO2 dropped to 88% on room air with laboured breathing over the last 10 minutes.", background: "Hx: Atrial Fibrillation, Heart Failure. Allergies: Codeine. Active meds: Warfarin 5mg.", assessment: "Possible acute respiratory distress / fluid overload; vitals trending down.", recommendation: "Request physician review now — consider O2 and stat orders.", priority: "EMERGENCY", status: "OPEN", raisedBy: "Sarah Jenkins, RN", raisedByRole: "NURSE", assignedToRole: "PHYSICIAN", createdAt: minsAgo(4) },
      { residentId: R["305"].id, situation: "Increasing confusion and agitation since afternoon; refusing evening medications.", background: "Hx: Alzheimer's, Arthritis. Memory-care resident.", assessment: "Sundowning vs delirium — needs medical review.", recommendation: "Please advise on management / medication review.", priority: "URGENT", status: "ACKNOWLEDGED", raisedBy: "Sarah Jenkins, RN", raisedByRole: "NURSE", assignedToRole: "PHYSICIAN", acknowledgedBy: "Dr. Alan Reyes", acknowledgedAt: minsAgo(12), createdAt: minsAgo(26) },
      { residentId: R["302"].id, situation: "BP 165/95 on morning check with a mild headache.", background: "Hx: Hypertension, Type 2 Diabetes. Allergies: Penicillin, Sulfa.", assessment: "Blood pressure above target range.", recommendation: "Review antihypertensive regimen.", priority: "ROUTINE", status: "RESOLVED", raisedBy: "Caleb Randall", raisedByRole: "CAREGIVER", assignedToRole: "PHYSICIAN", acknowledgedBy: "Dr. Alan Reyes", acknowledgedAt: hoursAgo(3), response: "Increase lisinopril to 20mg daily; recheck BP each shift and report any systolic > 160.", resolvedBy: "Dr. Alan Reyes", resolvedAt: hoursAgo(2.5), createdAt: hoursAgo(4) },
    ]);
    console.log("  • SBAR escalations ready");
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
