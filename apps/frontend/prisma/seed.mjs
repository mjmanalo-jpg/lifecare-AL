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

  addNotif(physicianUser, "VITAL_ALERT", "Arthur Pendelton Vitals Alert", "Arthur's Heart Rate spiked to 104 bpm during therapy. Vitals now stable.");
  addNotif(physicianUser, "MEDICATION_REMINDER", "Medication Warning", "Frank Osei (Room 312) medication overdue by 2 hours.");
  addNotif(physicianUser, "MESSAGE", "New Handover Note", "Sarah Jenkins, RN submitted clinical handover reports.");

  addNotif(nurseUser2, "CALL_BELL", "Emergency Call Bell: Room 302", "Arthur Pendelton triggered the room call bell. Assistance needed.");
  addNotif(nurseUser2, "VITAL_ALERT", "Arthur SpO2 Dropped", "Oxygen saturation level dipped below 95% temporarily.");
  addNotif(nurseUser2, "INCIDENT_REPORT", "Fall Heuristics Alert", "Room 305 vision feed triggered a potential balance loss warning.");

  addNotif(caregiverUser, "CALL_BELL", "Call Bell: Room 302 Assistance", "Help requested with repositioning and physical comfort checks.");
  addNotif(caregiverUser, "TASK_ASSIGNMENT", "Checklist Pending", "3 morning wellness and dietary tasks remain incomplete.");
  addNotif(caregiverUser, "SHIFT_REMINDER", "Clock-In Reminder", "Afternoon shift starts in 30 minutes. Please prepare for shift handover.");

  addNotif(familyUser, "VITAL_ALERT", "Relative Vitals Stable", "Arthur Pendelton's morning vitals registered healthy (BP 120/80).");
  addNotif(familyUser, "MEDICATION_REMINDER", "Medications Administered", "Head Nurse Sarah Jenkins successfully administered daily blood pressure pills.");
  addNotif(familyUser, "MESSAGE", "Daily Comfort Report", "Caleb Randall reports Arthur slept comfortably and participated in social games.");

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
