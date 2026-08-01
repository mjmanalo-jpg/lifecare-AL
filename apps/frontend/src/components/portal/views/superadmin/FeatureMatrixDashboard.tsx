"use client";
import { useMemo, useState } from "react";
import {
  ShieldCheck, Users, Bed, Activity, Pill, ClipboardList, Target,
  AlertTriangle, FileText, Stethoscope, Bell, Clock, Bus, Utensils,
  Wrench, BarChart3, Calendar, Settings, Heart, BookOpen, Droplets,
  CheckCircle2, XCircle, type LucideIcon,
} from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import PortalMatrixEditor from "./PortalMatrixEditor";

interface FeatureItem {
  name: string;
  icon?: LucideIcon;
  category: string;
  implemented: boolean;
  modelKey?: string;
  route?: string;
}

interface RoleAccess {
  role: string;
  label: string;
  icon: LucideIcon;
  color: string;
  features: string[];
}

const ROLES: RoleAccess[] = [
  { role: "SUPERADMIN", label: "Super Admin", icon: ShieldCheck, color: "text-purple-600 bg-purple-50", features: ["System Settings","Feature Matrix","User Management","Community Management","All Portals Access","Audit Logs","KPI Dashboards","Staff Registry","Admissions","Rooms","Inventory","Billing","Clinical Reports"] },
  { role: "FACILITY_ADMIN", label: "Facility Admin", icon: Settings, color: "text-blue-600 bg-blue-50", features: ["Staff Management","Admissions","Rooms","Occupancy","Inventory","Billing","Incidents","Audit Logs","Vaccinations","Documents","Clinical Reports","Inventory Alerts","Daily Rounds"] },
  { role: "NURSE", label: "Head Nurse", icon: Stethoscope, color: "text-emerald-600 bg-emerald-50", features: ["Tasks","Care Plans","Medications","MAR","Vitals","Incidents","Escalations","Daily Rounds","Vaccinations","Documents","Care Team","Shift Reports","Follow-ups","Clinical Notes"] },
  { role: "PHYSICIAN", label: "Physician", icon: Stethoscope, color: "text-indigo-600 bg-indigo-50", features: ["Care Plans","Orders","Rounds","Notes","Messages","Medications","Vitals","Incidents","Escalations","Daily Rounds","Documents","Follow-ups","Consults"] },
  { role: "CAREGIVER", label: "Caregiver", icon: Heart, color: "text-rose-600 bg-rose-50", features: ["Daily Rounds","Tasks","Care Plans","Medications","MAR","Residents","Call Bells","Time Clock","Vaccinations","Documents","Follow-ups","Care Team","Escalations"] },
  { role: "FAMILY", label: "Family Member", icon: Users, color: "text-amber-600 bg-amber-50", features: ["Resident Profile","Care Plans","Documents","Vitals","Medications","Incidents","Messages","Appointments","Billing","Care Timeline"] },
  { role: "RESIDENT", label: "Resident", icon: Heart, color: "text-teal-600 bg-teal-50", features: ["Vitals","Medications","Documents","Care Plans","Vaccinations","Messages","Billing"] },
  { role: "DRIVER", label: "Driver", icon: Bus, color: "text-orange-600 bg-orange-50", features: ["Transport Requests","Trip Board","Vehicles","Fuel Logs","Maintenance"] },
  { role: "CONCIERGE", label: "Concierge", icon: Bell, color: "text-pink-600 bg-pink-50", features: ["Resident Services","Front Desk","Concierge","Community Events","Announcements"] },
];

const CATEGORIES = [
  {
    name: "Core & Identity",
    features: [
      { name: "User Accounts & Auth", icon: Users, modelKey: "users", implemented: true },
      { name: "Role-Based Portals", icon: ShieldCheck, implemented: true },
      { name: "Organization Hierarchy", icon: Settings, modelKey: "organizations", implemented: true },
      { name: "Community Management", icon: Settings, modelKey: "communities", implemented: true },
      { name: "Building/Floor/Unit", icon: Bed, modelKey: "buildings", implemented: true },
    ],
  },
  {
    name: "Resident Profile & Care Record",
    features: [
      { name: "Resident Demographics", icon: Users, modelKey: "residents", implemented: true },
      { name: "Room Assignment", icon: Bed, modelKey: "rooms", implemented: true },
      { name: "Admissions", icon: ClipboardList, modelKey: "admissions", implemented: true },
      { name: "Documents & Records", icon: FileText, modelKey: "resident-documents", implemented: true },
      { name: "Vaccination Tracking", icon: Activity, modelKey: "vaccinations", implemented: true },
      { name: "Resident Preferences", icon: Settings, modelKey: "resident-preferences", implemented: true },
      { name: "Resident Notes", icon: FileText, modelKey: "resident-notes", implemented: true },
    ],
  },
  {
    name: "Assessment & Acuity Engine",
    features: [
      { name: "Multi-Dimensional Assessment", icon: ClipboardList, modelKey: "assessments", implemented: true },
      { name: "Acuity Scoring (1-5)", icon: BarChart3, modelKey: "acuity-scores", implemented: true },
      { name: "Care Level Assignment", icon: Target, implemented: true },
      { name: "IADL/Infection/Dependency", icon: Activity, implemented: true },
    ],
  },
  {
    name: "Care Planning",
    features: [
      { name: "Care Plans", icon: Target, modelKey: "care-plans", implemented: true },
      { name: "Care Plan Items/Goals", icon: Target, modelKey: "care-plan-items", implemented: true },
      { name: "Care Plan Reviews", icon: ClipboardList, modelKey: "care-plan-reviews", implemented: true },
      { name: "Service Catalog & Packages", icon: Settings, modelKey: "service-catalogs", implemented: true },
      { name: "Resident Goals", icon: Target, modelKey: "resident-goals", implemented: true },
    ],
  },
  {
    name: "Daily Documentation (10 Areas)",
    features: [
      { name: "Bowel Tracking (Bristol 1-7)", icon: Droplets, modelKey: "bowel-records", implemented: true, route: "dailyrounds" },
      { name: "Urine Output & Color", icon: Droplets, modelKey: "urine-records", implemented: true, route: "dailyrounds" },
      { name: "Edema Assessment", icon: Activity, modelKey: "edema-records", implemented: true, route: "dailyrounds" },
      { name: "Concerns & Escalation", icon: AlertTriangle, modelKey: "concern-records", implemented: true, route: "dailyrounds" },
      { name: "Pain Assessment (0-10)", icon: Activity, modelKey: "pain-records", implemented: true, route: "dailyrounds" },
      { name: "Mood & Behavior", icon: Activity, modelKey: "mood-records", implemented: true, route: "dailyrounds" },
      { name: "Sleep Quality & Duration", icon: Activity, modelKey: "round-sleep-records", implemented: true, route: "dailyrounds" },
      { name: "Mobility & Transfers", icon: Activity, modelKey: "mobility-records", implemented: true, route: "dailyrounds" },
      { name: "Meals & Nutrition", icon: Utensils, modelKey: "meal-records", implemented: true, route: "dailyrounds" },
      { name: "Vital Signs (Composite)", icon: Activity, modelKey: "vital-signs", implemented: true, route: "dailyrounds" },
      { name: "Daily Round Master", icon: ClipboardList, modelKey: "daily-rounds", implemented: true },
      { name: "Shift-Based (Day/Eve/Night)", icon: Clock, implemented: true },
    ],
  },
  {
    name: "Medication Management",
    features: [
      { name: "Medication Orders", icon: Pill, modelKey: "medications", implemented: true },
      { name: "MAR (Admin/Refused/Held)", icon: Pill, modelKey: "medication-administrations", implemented: true },
      { name: "Medication Change Log", icon: FileText, modelKey: "medication-change-logs", implemented: true },
      { name: "Medication Logs", icon: Pill, modelKey: "medication-logs", implemented: true },
      { name: "Inventory Alerts", icon: Bell, modelKey: "inventory-alerts", implemented: true },
      { name: "Inventory Items", icon: Settings, modelKey: "inventory", implemented: true },
    ],
  },
  {
    name: "Clinical Coordination",
    features: [
      { name: "SBAR Escalations", icon: AlertTriangle, modelKey: "escalations", implemented: true },
      { name: "Hospital Referrals", icon: Activity, modelKey: "hospital-referrals", implemented: true },
      { name: "Follow-up Tracker", icon: Calendar, modelKey: "follow-ups", implemented: true },
      { name: "Clinical Notes", icon: FileText, modelKey: "medical-notes", implemented: true },
      { name: "Care Timeline", icon: Clock, modelKey: "care-timeline", implemented: true },
    ],
  },
  {
    name: "Incidents & Safety",
    features: [
      { name: "Incident Reporting", icon: AlertTriangle, modelKey: "incidents", implemented: true },
      { name: "Call Bell System", icon: Bell, modelKey: "call-bells", implemented: true },
      { name: "Camera Monitoring", icon: Activity, modelKey: "camera-monitoring-logs", implemented: true },
      { name: "Observation Logs", icon: ClipboardList, modelKey: "observations", implemented: true },
    ],
  },
  {
    name: "Communication",
    features: [
      { name: "Secure Messages", icon: Bell, modelKey: "messages", implemented: true },
      { name: "Notifications", icon: Bell, modelKey: "notifications", implemented: true },
      { name: "Announcements", icon: Bell, modelKey: "announcements", implemented: true },
    ],
  },
  {
    name: "Scheduling & Tasks",
    features: [
      { name: "Task Management", icon: ClipboardList, modelKey: "tasks", implemented: true },
      { name: "Shift Reports", icon: FileText, modelKey: "shift-reports", implemented: true },
      { name: "Time Clock", icon: Clock, modelKey: "time-tracking", implemented: true },
    ],
  },
  {
    name: "Fleet & Transport",
    features: [
      { name: "Vehicle Management", icon: Bus, modelKey: "vehicles", implemented: true },
      { name: "Driver Management", icon: Users, modelKey: "drivers", implemented: true },
      { name: "Transport Requests", icon: ClipboardList, modelKey: "transport-requests", implemented: true },
      { name: "Trip Tracking", icon: Activity, modelKey: "trips", implemented: true },
      { name: "Vehicle Maintenance", icon: Wrench, modelKey: "vehicle-maintenance", implemented: true },
      { name: "Fuel Logs", icon: Settings, modelKey: "fuel-logs", implemented: true },
    ],
  },
  {
    name: "Hotel & Hospitality",
    features: [
      { name: "Service Requests", icon: Bell, modelKey: "service-requests", implemented: true },
      { name: "Facility Maintenance", icon: Wrench, modelKey: "facility-maintenance", implemented: true },
      { name: "Concierge Bookings", icon: Bell, modelKey: "concierge-bookings", implemented: true },
      { name: "Front Desk Visits", icon: Users, modelKey: "front-desk-visits", implemented: true },
      { name: "Room Turnover", icon: Bed, modelKey: "room-turnovers", implemented: true },
      { name: "Community Events", icon: Calendar, modelKey: "community-events", implemented: true },
      { name: "Dining Reservations", icon: Utensils, modelKey: "dining-reservations", implemented: true },
      { name: "Daily Menus", icon: Utensils, modelKey: "daily-menus", implemented: true },
      { name: "Dietitian Consults", icon: Activity, modelKey: "dietitian-consults", implemented: true },
      { name: "Food Compliance", icon: CheckCircle2, modelKey: "food-compliance-logs", implemented: true },
    ],
  },
  {
    name: "Quality & Governance",
    features: [
      { name: "Resident Quality Scores", icon: BarChart3, modelKey: "resident-quality-scores", implemented: true },
      { name: "Community Quality Dashboard", icon: BarChart3, modelKey: "community-quality-dashboards", implemented: true },
      { name: "KPI Records", icon: BarChart3, modelKey: "kpi-records", implemented: true },
      { name: "SOPs & Competencies", icon: BookOpen, modelKey: "community-sops", implemented: true },
      { name: "Staff Competencies", icon: ClipboardList, modelKey: "staff-competencies", implemented: true },
      { name: "Audit Logs", icon: ShieldCheck, modelKey: "audit-logs", implemented: true },
      { name: "Staffing Plans", icon: Users, modelKey: "staffing-plans", implemented: true },
    ],
  },
  {
    name: "Billing & Finance",
    features: [
      { name: "Invoicing", icon: Settings, modelKey: "invoices", implemented: true },
      { name: "Service Charges", icon: Settings, modelKey: "service-charges", implemented: true },
      { name: "Payments", icon: Settings, modelKey: "payments", implemented: true },
      { name: "Insurance Validation", icon: Settings, modelKey: "insurance-validations", implemented: true },
    ],
  },
  {
    name: "Reporting",
    features: [
      { name: "Clinical Reports", icon: BarChart3, modelKey: "generated-reports", implemented: true },
      { name: "Incident Reports", icon: AlertTriangle, implemented: true },
      { name: "Vitals Trend Reports", icon: Activity, implemented: true },
      { name: "Care Plan Reports", icon: Target, implemented: true },
      { name: "Compliance Reports", icon: CheckCircle2, implemented: true },
    ],
  },
  {
    name: "Knowledge & AI",
    features: [
      { name: "Knowledge Base", icon: BookOpen, modelKey: "knowledge-docs", implemented: true },
      { name: "AI Assistant", icon: Activity, implemented: true, route: "assistant" },
      { name: "AI Vision (Camera)", icon: Activity, implemented: true },
    ],
  },
  {
    name: "Infrastructure",
    features: [
      { name: "Realtime Supabase Subscriptions", icon: Activity, implemented: true },
      { name: "Generic CRUD API (/api/db/[model])", icon: Settings, implemented: true },
      { name: "File Upload (/api/upload)", icon: FileText, implemented: true },
      { name: "WebSocket Endpoints", icon: Bell, implemented: true },
      { name: "Live Polling Fallback", icon: Clock, implemented: true },
      { name: "Multi-tenant Data Isolation", icon: ShieldCheck, implemented: true },
    ],
  },
];

export default function FeatureMatrixDashboard({ initialTab = "overview" }: { initialTab?: "overview" | "matrix" }) {
  const resQ = useLiveQuery("residents", { query: "take=1000", tables: ["Resident"] });
  const staffQ = useLiveQuery("staff", { query: "take=1000", tables: ["Staff"] });
  const userQ = useLiveQuery("users", { query: "take=1000", tables: ["User"] });
  const taskQ = useLiveQuery("tasks", { query: "take=1000", tables: ["Task"] });
  const medQ = useLiveQuery("medications", { query: "take=1000", tables: ["Medication"] });
  const incQ = useLiveQuery("incidents", { query: "take=1000", tables: ["Incident"] });
  const planQ = useLiveQuery("care-plans", { query: "take=1000", tables: ["CarePlan"] });
  const escQ = useLiveQuery("escalations", { query: "take=1000", tables: ["Escalation"] });
  const roundQ = useLiveQuery("daily-rounds", { query: "take=1000", tables: ["DailyRound"] });
  const roomQ = useLiveQuery("rooms", { query: "take=1000", tables: ["Room"] });
  const commQ = useLiveQuery("communities", { query: "take=1000", tables: ["Community"] });
  const orgQ = useLiveQuery("organizations", { query: "take=1000", tables: ["Organization"] });

  const stats = useMemo(() => [
    { label: "Organizations", value: orgQ.data?.length ?? 0, icon: Settings, color: "text-purple-600" },
    { label: "Communities", value: commQ.data?.length ?? 0, icon: Settings, color: "text-indigo-600" },
    { label: "Residents", value: resQ.data?.length ?? 0, icon: Users, color: "text-emerald-600" },
    { label: "Staff", value: staffQ.data?.length ?? 0, icon: Stethoscope, color: "text-blue-600" },
    { label: "Users", value: userQ.data?.length ?? 0, icon: Users, color: "text-amber-600" },
    { label: "Rooms", value: roomQ.data?.length ?? 0, icon: Bed, color: "text-teal-600" },
    { label: "Care Plans", value: planQ.data?.length ?? 0, icon: Target, color: "text-pink-600" },
    { label: "Tasks", value: taskQ.data?.length ?? 0, icon: ClipboardList, color: "text-orange-600" },
    { label: "Medications", value: medQ.data?.length ?? 0, icon: Pill, color: "text-red-600" },
    { label: "Incidents", value: incQ.data?.length ?? 0, icon: AlertTriangle, color: "text-red-700" },
    { label: "Escalations", value: escQ.data?.length ?? 0, icon: Bell, color: "text-rose-600" },
    { label: "Daily Rounds", value: roundQ.data?.length ?? 0, icon: ClipboardList, color: "text-emerald-700" },
  ], [orgQ.data, commQ.data, resQ.data, staffQ.data, userQ.data, roomQ.data, planQ.data, taskQ.data, medQ.data, incQ.data, escQ.data, roundQ.data]);

  const [view, setView] = useState<"overview" | "matrix">(initialTab);

  const totalFeatures = CATEGORIES.reduce((sum, c) => sum + c.features.length, 0);
  const implementedFeatures = CATEGORIES.reduce((sum, c) => sum + c.features.filter(f => f.implemented).length, 0);

  return (
    <div className="space-y-6">
      {/* Header + combined-view tabs */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2 mb-3">
          <ShieldCheck className="w-5 h-5 text-purple-600" />
          SLMS Feature Matrix &amp; Access Control
        </h2>
        <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto">
          <button
            onClick={() => setView("overview")}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${view === "overview" ? "border-purple-600 text-purple-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          >
            <BarChart3 className="w-4 h-4" /> System Overview
          </button>
          <button
            onClick={() => setView("matrix")}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${view === "matrix" ? "border-purple-600 text-purple-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          >
            <ShieldCheck className="w-4 h-4" /> Access Control Matrix
          </button>
        </div>
      </div>

      {view === "matrix" ? (
        <PortalMatrixEditor />
      ) : (
      <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-gray-800">System Overview</h3>
        <span className="text-sm text-gray-500">{implementedFeatures}/{totalFeatures} features implemented</span>
      </div>

      {/* System Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-white rounded-xl border p-3 text-center">
              <Icon className={`w-5 h-5 mx-auto mb-1 ${s.color}`} />
              <p className="text-lg font-bold text-gray-900">{s.value}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">{s.label}</p>
            </div>
          );
        })}
      </div>

      {/* Implementation Progress */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-gray-800">Implementation Progress</h3>
          <span className="text-sm font-bold text-emerald-600">{Math.round((implementedFeatures / totalFeatures) * 100)}%</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-3">
          <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 h-3 rounded-full transition-all" style={{ width: `${(implementedFeatures / totalFeatures) * 100}%` }} />
        </div>
        <p className="text-xs text-gray-500 mt-1">{implementedFeatures} of {totalFeatures} SLMS spec features fully implemented</p>
      </div>

      {/* Feature Categories */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {CATEGORIES.map((cat) => (
          <div key={cat.name} className="bg-white rounded-xl border p-4">
            <h4 className="font-semibold text-gray-800 text-sm mb-3">{cat.name}</h4>
            <div className="space-y-1.5">
              {cat.features.map((f) => (
                <div key={f.name} className="flex items-center gap-2 text-xs">
                  {f.implemented ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                  )}
                  <span className={f.implemented ? "text-gray-700" : "text-gray-400"}>{f.name}</span>
                  {f.modelKey && <span className="ml-auto text-[10px] text-gray-400 font-mono">{f.modelKey}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Role Access Matrix */}
      <div className="bg-white rounded-xl border p-4 overflow-x-auto">
        <h3 className="font-semibold text-gray-800 text-sm mb-4">Role-Based Feature Access Matrix</h3>
        <table className="w-full min-w-[640px] text-xs">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 pr-4 font-semibold text-gray-600">Role</th>
              {CATEGORIES.slice(0, 10).map((cat) => (
                <th key={cat.name} className="text-center py-2 px-1 font-semibold text-gray-600 min-w-[60px]">{cat.name.split(" ")[0]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLES.map((r) => {
              const Icon = r.icon;
              return (
                <tr key={r.role} className="border-b last:border-0">
                  <td className="py-2 pr-4">
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-semibold ${r.color}`}>
                      <Icon className="w-3 h-3" />
                      {r.label}
                    </div>
                  </td>
                  {CATEGORIES.slice(0, 10).map((cat) => {
                    const hasAccess = cat.features.some(f => r.features.some(rf => rf.toLowerCase().includes(f.name.split(" ")[0].toLowerCase().substring(0, 4))));
                    return (
                      <td key={cat.name} className="text-center py-2 px-1">
                        {hasAccess ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Tech Stack */}
      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-semibold text-gray-800 text-sm mb-3">Technology Stack</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          {[
            { label: "Frontend", items: ["Next.js 16","React 19","TypeScript","TailwindCSS"] },
            { label: "Backend", items: ["FastAPI","SQLAlchemy","asyncpg","Pydantic"] },
            { label: "Database", items: ["Supabase PostgreSQL","Prisma ORM","86+ Models","75 Enums"] },
            { label: "Realtime", items: ["Supabase Subscriptions","WebSocket","Polling Fallback","useLiveQuery"] },
            { label: "Auth", items: ["Email/Password","bcryptjs","Credentials Only","Server Cookie"] },
            { label: "API", items: ["Generic CRUD","49+ REST Endpoints","4 WebSocket","File Upload"] },
            { label: "Portals", items: ["9 Role Portals","150+ Components","86+ API Routes","10 Daily Areas"] },
            { label: "Infrastructure", items: ["Vercel Deploy","Supabase DB","Multi-tenant","HIPAA-ready"] },
          ].map((s) => (
            <div key={s.label} className="bg-gray-50 rounded-lg p-3">
              <p className="font-semibold text-gray-700 mb-1">{s.label}</p>
              {s.items.map((item) => (
                <p key={item} className="text-gray-500">· {item}</p>
              ))}
            </div>
          ))}
        </div>
      </div>
      </div>
      )}
    </div>
  );
}
