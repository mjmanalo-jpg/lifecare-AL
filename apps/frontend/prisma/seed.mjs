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
    { email: "sarah.jenkins@goldenhearth.com", name: "Sarah Jenkins", role: "NURSE", phone: "555-0101" },
    { email: "rebecca.wilson@goldenhearth.com", name: "Rebecca Wilson", role: "NURSE", phone: "555-0105" },
    { email: "caleb.randall@goldenhearth.com", name: "Caleb Randall", role: "CAREGIVER", phone: "555-0102" },
    { email: "james.mitchell@goldenhearth.com", name: "James Mitchell", role: "CAREGIVER", phone: "555-0104" },
    { email: "maria.santos@goldenhearth.com", name: "Maria Santos", role: "CAREGIVER", phone: "555-0103" },
    { email: "john.pendelton@family.com", name: "John Pendelton", role: "FAMILY", phone: "555-0200" },
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
    { email: "sarah.jenkins@goldenhearth.com", position: "Head Nurse", department: "Clinical Care", hireDate: daysAgo(1200) },
    { email: "rebecca.wilson@goldenhearth.com", position: "RN - Supervisor", department: "Clinical Care", hireDate: daysAgo(1800) },
    { email: "caleb.randall@goldenhearth.com", position: "Caregiver", department: "Daily Assistance", hireDate: daysAgo(560) },
    { email: "james.mitchell@goldenhearth.com", position: "Caregiver", department: "Daily Assistance", hireDate: daysAgo(300) },
    { email: "maria.santos@goldenhearth.com", position: "Nurse Aide", department: "Clinical Support", hireDate: daysAgo(1500), isActive: false },
  ];
  const out = [];
  for (const r of rows) {
    const user = users[r.email];
    if (!user) continue;
    const rec = await prisma.staff.upsert({
      where: { userId: user.id },
      update: { position: r.position, department: r.department, isActive: r.isActive ?? true },
      create: { userId: user.id, position: r.position, department: r.department, hireDate: r.hireDate, isActive: r.isActive ?? true },
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

  await seedIfEmpty("callBell", () => [
    { residentId: R["312"].id, status: "PENDING", reason: "Assistance requested" },
    { residentId: R["305"].id, status: "RESOLVED", reason: "Water refill", resolvedAt: hoursAgo(3) },
  ]);

  if (familyUser) {
    await seedIfEmpty("notification", () => [
      { userId: familyUser.id, type: "VITAL_ALERT", title: "Vitals recorded", message: "New vitals logged for Arthur Pendelton." },
      { userId: familyUser.id, type: "MESSAGE", title: "New message", message: "You have a new message from the care team." },
    ]);
  }

  if (nurse && nurseUser) {
    await seedIfEmpty("shiftReport", () => [
      { staffId: nurse.id, userId: nurseUser.id, shiftType: "MORNING", date: daysAgo(1), summary: "Quiet shift. All residents stable.", handoverNotes: "Watch Room 312 BP." },
      { staffId: nurse.id, userId: nurseUser.id, shiftType: "AFTERNOON", date: new Date(), summary: "PT sessions completed. One fall alert resolved.", handoverNotes: "Room 305 needs supervision overnight." },
    ]);
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
