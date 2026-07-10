import { prisma } from "./prisma";

/**
 * Whitelist of data models exposed through /api/db/[model].
 * `key`      → URL segment used by the frontend (kebab-case).
 * `delegate` → the Prisma model accessor.
 * `table`    → the Postgres table name (PascalCase) for Supabase realtime.
 * `orderBy`  → default sort for list queries.
 */
export interface ModelDef {
  // Prisma delegates share no common public type; `any` is intentional here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delegate: any;
  table: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  orderBy?: Record<string, any>;
}

export const MODELS: Record<string, ModelDef> = {
  users: { delegate: prisma.user, table: "User", orderBy: { createdAt: "desc" } },
  residents: { delegate: prisma.resident, table: "Resident", orderBy: { createdAt: "desc" } },
  staff: { delegate: prisma.staff, table: "Staff", orderBy: { createdAt: "desc" } },
  vitals: { delegate: prisma.vitalsLog, table: "VitalsLog", orderBy: { recordedAt: "desc" } },
  incidents: { delegate: prisma.incident, table: "Incident", orderBy: { incidentDate: "desc" } },
  medications: { delegate: prisma.medication, table: "Medication", orderBy: { startDate: "desc" } },
  tasks: { delegate: prisma.task, table: "Task", orderBy: { dueDate: "asc" } },
  messages: { delegate: prisma.message, table: "Message", orderBy: { createdAt: "desc" } },
  "shift-reports": { delegate: prisma.shiftReport, table: "ShiftReport", orderBy: { date: "desc" } },
  notifications: { delegate: prisma.notification, table: "Notification", orderBy: { createdAt: "desc" } },
  visits: { delegate: prisma.visit, table: "Visit", orderBy: { checkInTime: "desc" } },
  invoices: { delegate: prisma.invoice, table: "Invoice", orderBy: { dueDate: "desc" } },
  "resident-notes": { delegate: prisma.residentNote, table: "ResidentNote", orderBy: { createdAt: "desc" } },
  "medical-notes": { delegate: prisma.medicalNote, table: "MedicalNote", orderBy: { createdAt: "desc" } },
  "call-bells": { delegate: prisma.callBell, table: "CallBell", orderBy: { createdAt: "desc" } },
  "time-tracking": { delegate: prisma.timeTracking, table: "TimeTracking", orderBy: { startTime: "desc" } },
  "knowledge-docs": { delegate: prisma.knowledgeDoc, table: "KnowledgeDoc", orderBy: { createdAt: "desc" } },
  "app-settings": { delegate: prisma.appSetting, table: "AppSetting", orderBy: { id: "asc" } },
  admissions: { delegate: prisma.admission, table: "Admission", orderBy: { createdAt: "desc" } },
  rooms: { delegate: prisma.room, table: "Room", orderBy: { roomNumber: "asc" } },
  inventory: { delegate: prisma.inventoryItem, table: "InventoryItem", orderBy: { itemName: "asc" } },
  "service-charges": { delegate: prisma.serviceCharge, table: "ServiceCharge", orderBy: { serviceDate: "desc" } },
  "insurance-validations": { delegate: prisma.insuranceValidation, table: "InsuranceValidation", orderBy: { createdAt: "desc" } },
  payments: { delegate: prisma.payment, table: "Payment", orderBy: { paymentDate: "desc" } },
  "blog-posts": { delegate: prisma.blogPost, table: "BlogPost", orderBy: { publishedAt: "desc" } },
  "site-content": { delegate: prisma.siteContent, table: "SiteContent", orderBy: { id: "asc" } },
  "custom-pages": { delegate: prisma.customPage, table: "CustomPage", orderBy: { sortOrder: "asc" } },
};

export function getModel(key: string): ModelDef | undefined {
  return MODELS[key];
}

/**
 * True only when a real database connection string is present. Until the user
 * fills in DATABASE_URL (it ships as a `<PROJECT_REF>` placeholder), the API
 * routes serve demo data so the portals are fully populated instead of erroring.
 */
export function isDbConfigured(): boolean {
  const url = process.env.DATABASE_URL;
  return Boolean(url) && !url.includes("<");
}
