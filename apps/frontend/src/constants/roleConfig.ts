import {
  Grid,
  Activity,
  Users,
  Settings,
  ShieldCheck,
  AlertTriangle,
  CheckCircle,
  Clock,
  User,
  MessageSquare,
  DollarSign,
  Palette,
  Sparkles,
  Building2,
  Stethoscope,
  UserRound,
  UserPlus,
  DoorOpen,
  BedDouble,
  Package,
  FileText,
  Pill,
  BellRing,
  Timer,
  ClipboardList,
  BookOpen,
  TrendingUp,
  PenTool,
  Target,
  Bus,
  Car,
  Route,
  Wrench,
  Fuel,
  Utensils,
  Ticket,
  ConciergeBell,
  Repeat,
  CalendarDays,
  Siren,
  Syringe,
  FolderOpen,
  CalendarCheck,
  BarChart3,
  Shield,
  ClipboardCheck,
  Bell,
} from "lucide-react";

export type Role =
  | "SUPERADMIN"
  | "FACILITY_ADMIN"
  | "PHYSICIAN"
  | "NURSE"
  | "CAREGIVER"
  | "FAMILY"
  | "RESIDENT"
  | "FLEET_MANAGEMENT"
  | "DRIVER";

export interface SidebarLink {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  route: string;
}

export interface RoleDetails {
  name: string;
  badge: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  profileName: string;
  footerText: string;
  basePath: string;
  sidebarLinks: SidebarLink[];
}

export const ROUTE_TO_TAB: Record<string, string> = {
  dashboard: "Reporting & Care Intelligence",
  monitoring: "Vitals Monitor",
  incidents: "Incident Log",
  records: "Resident Profile & Care Record",
  staff: "Staff Registry",
  tasks: "Daily Care Documentation & Monitoring",
  residents: "Resident Profile & Care Record",
  reports: "Shift Endorsement & Continuity",
  relative: "Resident Profile & Care Record",
  timeline: "Health Timeline",
  report: "Daily Care Documentation & Monitoring",
  alerts: "Alerts",
  messages: "Messages",
  photos: "Photos",
  appointments: "Appointments",
  expenses: "Billing",
  goals: "Care Planning",
  admin: "Reporting & Care Intelligence",
  shift: "Reporting & Care Intelligence",
  family: "Reporting & Care Intelligence",
  appearance: "Landing Studio",
  assistant: "AI Assistant",
  matrix: "Portal Matrix",
  admissions: "Admissions & Registration",
  registration: "Admissions & Registration",
  rooms: "Rooms",
  occupancy: "Occupancy",
  billing: "Billing",
  inventory: "Medication Management & Inventory",
  medications: "Medication Management & Inventory",
  callbells: "Call Bells",
  timeclock: "Time Clock",
  rounds: "Assessment & Level of Care",
  casereview: "Assessment & Level of Care",
  careplans: "Care Planning",
  consults: "Consults & Referrals",
  escalations: "Clinical Coordination",
  orders: "Medication Management & Inventory",
  notes: "Care Planning",
  vitals: "Vitals Trends",
  careteam: "Care Team",
  requests: "Transport Requests",
  trips: "Trip Board",
  vehicles: "Vehicles",
  drivers: "Drivers",
  maintenance: "Maintenance",
  fuel: "Fuel & Odometer",
  transport: "Transport",
  dining: "Dining & Compliance",
  checklist: "Inspection Checklist",
  services: "Resident Services",
  concierge: "Concierge",
  frontdesk: "Front Desk",
  turnover: "Unit Turnover",
  community: "Community & Events",
  documentation: "Daily Care Documentation & Monitoring",
  vaccinations: "Vaccinations",
  documents: "Resident Documents",
  mar: "Medication Administration Record",
  followups: "Follow-up Tracker",
  auditlog: "Audit Log",
  "inventory-alerts": "Inventory Alerts",
  clinicalreports: "Clinical Reports",
  taskboard: "Daily Care Documentation & Monitoring",
  dailyrounds: "Daily Rounds — Bedside Documentation",
  featurematrix: "LCMS Feature Matrix & System Overview",
};

export const PATH_TO_ROLE: Record<string, Role> = {
  nurse: "NURSE",
  superadmin: "SUPERADMIN",
  caregiver: "CAREGIVER",
  family: "FAMILY",
  facility_admin: "FACILITY_ADMIN",
  physician: "PHYSICIAN",
  resident: "RESIDENT",
  fleet_management: "FLEET_MANAGEMENT",
  driver: "DRIVER",
};

export const ROLES: Record<Role, RoleDetails> = {
  SUPERADMIN: {
    name: "Super Admin",
    badge: "Operations",
    desc: "Oversee entire facility operations, manage staff registries, and monitor system health telemetry.",
    icon: Settings,
    profileName: "System Admin",
    basePath: "/superadmin",
    footerText: "Super Admin Portal",
    sidebarLinks: [
      { name: "Reporting & Care Intelligence", icon: Grid, route: "/superadmin/dashboard" },
      { name: "LCMS Feature Matrix", icon: ShieldCheck, route: "/superadmin/featurematrix" },
      { name: "Daily Rounds (10-Area Bedside)", icon: ClipboardCheck, route: "/superadmin/dailyrounds" },
      // "Portal Matrix" is merged into "LCMS Feature Matrix" as its Access Control tab.
      { name: "Admissions & Registration", icon: UserPlus, route: "/superadmin/admissions" },
      { name: "Staff Registry", icon: Users, route: "/superadmin/staff" },
      { name: "AI Assistant", icon: Sparkles, route: "/superadmin/assistant" },
      { name: "Landing Studio", icon: Palette, route: "/superadmin/appearance" },
      // Core LCMS Modules Aligned
      { name: "Resident Profile & Care Record", icon: ShieldCheck, route: "/superadmin/records" },
      { name: "Assessment & Level of Care", icon: ClipboardList, route: "/superadmin/rounds" },
      { name: "Care Planning", icon: Target, route: "/superadmin/careplans" },
      { name: "Daily Care Documentation & Monitoring", icon: CheckCircle, route: "/superadmin/tasks" },
      { name: "Shift Endorsement & Continuity", icon: FileText, route: "/superadmin/reports" },
      { name: "Medication Management & Inventory", icon: Pill, route: "/superadmin/medications" },
      { name: "Clinical Coordination", icon: Siren, route: "/superadmin/escalations" },
      { name: "Vaccinations", icon: Syringe, route: "/superadmin/vaccinations" },
      { name: "Resident Documents", icon: FolderOpen, route: "/superadmin/documents" },
      { name: "Medication Administration Record", icon: Pill, route: "/superadmin/mar" },
      { name: "Audit Log", icon: Shield, route: "/superadmin/auditlog" },
      { name: "Inventory Alerts", icon: Bell, route: "/superadmin/inventory-alerts" },
      { name: "Clinical Reports", icon: BarChart3, route: "/superadmin/clinicalreports" },
    ],
  },
  NURSE: {
    name: "Head Nurse",
    badge: "Clinical Care",
    desc: "Access real-time resident vitals, receive instant fall detection warnings, and log via Voice AI.",
    icon: Activity,
    profileName: "Sarah Jenkins, RN",
    basePath: "/nurse",
    footerText: "Nurse Clinical Portal",
    sidebarLinks: [
      { name: "Reporting & Care Intelligence", icon: Grid, route: "/nurse/dashboard" },
      { name: "Daily Rounds (10-Area Bedside)", icon: ClipboardCheck, route: "/nurse/dailyrounds" },
      { name: "Assessment & Level of Care", icon: ClipboardList, route: "/nurse/rounds" },
      { name: "Resident Profile & Care Record", icon: ShieldCheck, route: "/nurse/records" },
      { name: "Medication Management & Inventory", icon: Pill, route: "/nurse/medications" },
      { name: "Care Planning", icon: Target, route: "/nurse/notes" },
      { name: "Clinical Coordination", icon: Siren, route: "/nurse/escalations" },
      { name: "Shift Endorsement & Continuity", icon: FileText, route: "/nurse/reports" },
      { name: "Orders & Prescriptions", icon: Pill, route: "/nurse/orders" },
      { name: "Incident Review", icon: AlertTriangle, route: "/nurse/incidents" },
      { name: "Secure Messages", icon: MessageSquare, route: "/nurse/messages" },
      // Core LCMS Modules Aligned
      { name: "Daily Care Documentation & Monitoring", icon: CheckCircle, route: "/nurse/tasks" },
      { name: "Vaccinations", icon: Syringe, route: "/nurse/vaccinations" },
      { name: "Resident Documents", icon: FolderOpen, route: "/nurse/documents" },
      { name: "Medication Administration Record", icon: Pill, route: "/nurse/mar" },
      { name: "Follow-up Tracker", icon: CalendarCheck, route: "/nurse/followups" },
      { name: "Audit Log", icon: Shield, route: "/nurse/auditlog" },
      { name: "Clinical Reports", icon: BarChart3, route: "/nurse/clinicalreports" },
    ],
  },
  CAREGIVER: {
    name: "On-Duty Caregiver",
    badge: "Daily Assistance",
    desc: "View resident assist checklists, check off task logs, and alert clinical staff of incidents.",
    icon: Users,
    profileName: "Caleb Randall",
    basePath: "/caregiver",
    footerText: "Caregiver Shift Portal",
    sidebarLinks: [
      { name: "Reporting & Care Intelligence", icon: Grid, route: "/caregiver/dashboard" },
      { name: "Daily Rounds (10-Area Bedside)", icon: ClipboardCheck, route: "/caregiver/dailyrounds" },
      { name: "Daily Care Documentation & Monitoring", icon: CheckCircle, route: "/caregiver/tasks" },
      { name: "Care Team", icon: Stethoscope, route: "/caregiver/careteam" },
      { name: "Call Bells", icon: BellRing, route: "/caregiver/callbells" },
      { name: "Clinical Coordination", icon: Siren, route: "/caregiver/escalations" },
      { name: "Resident Profile & Care Record", icon: Users, route: "/caregiver/residents" },
      { name: "Time Clock", icon: Timer, route: "/caregiver/timeclock" },
      { name: "Shift Endorsement & Continuity", icon: Clock, route: "/caregiver/reports" },
      // Core LCMS Modules Aligned
      { name: "Assessment & Level of Care", icon: ClipboardList, route: "/caregiver/rounds" },
      { name: "Care Planning", icon: Target, route: "/caregiver/careplans" },
      { name: "Medication Management & Inventory", icon: Pill, route: "/caregiver/medications" },
      { name: "Vaccinations", icon: Syringe, route: "/caregiver/vaccinations" },
      { name: "Resident Documents", icon: FolderOpen, route: "/caregiver/documents" },
      { name: "Medication Administration Record", icon: Pill, route: "/caregiver/mar" },
      { name: "Follow-up Tracker", icon: CalendarCheck, route: "/caregiver/followups" },
    ],
  },
  FAMILY: {
    name: "Family Sponsor",
    badge: "Family Portal",
    desc: "Monitor your relative's vitals timeline and check daily comfort summaries.",
    icon: ShieldCheck,
    profileName: "John Pendelton",
    basePath: "/family",
    footerText: "Family Portal",
    sidebarLinks: [
      { name: "Reporting & Care Intelligence", icon: Grid, route: "/family/dashboard" },
      { name: "Resident Profile & Care Record", icon: User, route: "/family/relative" },
      { name: "Daily Care Documentation & Monitoring", icon: CheckCircle, route: "/family/report" },
      { name: "Care Team", icon: Stethoscope, route: "/family/careteam" },
      { name: "Care Planning", icon: Target, route: "/family/goals" },
      { name: "Alerts", icon: AlertTriangle, route: "/family/alerts" },
      { name: "Messages", icon: MessageSquare, route: "/family/messages" },
      { name: "Appointments", icon: Clock, route: "/family/appointments" },
      { name: "Transport", icon: Bus, route: "/family/transport" },
      { name: "Hotel Services", icon: ConciergeBell, route: "/family/services" },
      { name: "Community & Events", icon: CalendarDays, route: "/family/community" },
      { name: "Billing", icon: DollarSign, route: "/family/expenses" },
      // Core LCMS Modules Aligned
      { name: "Assessment & Level of Care", icon: ClipboardList, route: "/family/rounds" },
      { name: "Shift Endorsement & Continuity", icon: FileText, route: "/family/reports" },
      { name: "Medication Management & Inventory", icon: Pill, route: "/family/medications" },
      { name: "Clinical Coordination", icon: Siren, route: "/family/escalations" },
      { name: "Vaccinations", icon: Syringe, route: "/family/vaccinations" },
      { name: "Resident Documents", icon: FolderOpen, route: "/family/documents" },
      { name: "Follow-up Tracker", icon: CalendarCheck, route: "/family/followups" },
    ],
  },
  FACILITY_ADMIN: {
    name: "Facility Admin",
    badge: "Facility Operations",
    desc: "Manage a single facility's staff, residents, and day-to-day operations.",
    icon: Building2,
    profileName: "Facility Admin",
    basePath: "/facility_admin",
    footerText: "Facility Admin Portal",
    sidebarLinks: [
      { name: "Reporting & Care Intelligence", icon: Grid, route: "/facility_admin/dashboard" },
      { name: "Daily Rounds (10-Area Bedside)", icon: ClipboardCheck, route: "/facility_admin/dailyrounds" },
      { name: "Resident Profile & Care Record", icon: UserRound, route: "/facility_admin/residents" },
      { name: "Staff", icon: Users, route: "/facility_admin/staff" },
      { name: "Rooms", icon: DoorOpen, route: "/facility_admin/rooms" },
      { name: "Occupancy", icon: BedDouble, route: "/facility_admin/occupancy" },
      { name: "Incidents", icon: AlertTriangle, route: "/facility_admin/incidents" },
      { name: "Clinical Coordination", icon: Siren, route: "/facility_admin/escalations" },
      { name: "Medication Management & Inventory", icon: Package, route: "/facility_admin/inventory" },
      { name: "Shift Endorsement & Continuity", icon: FileText, route: "/facility_admin/reports" },
      { name: "Billing", icon: DollarSign, route: "/facility_admin/billing" },
      { name: "Dining & Compliance", icon: Utensils, route: "/facility_admin/dining" },
      { name: "Resident Services", icon: Ticket, route: "/facility_admin/services" },
      { name: "Facility Maintenance", icon: Wrench, route: "/facility_admin/maintenance" },
      { name: "Concierge", icon: ConciergeBell, route: "/facility_admin/concierge" },
      { name: "Front Desk", icon: DoorOpen, route: "/facility_admin/frontdesk" },
      { name: "Unit Turnover", icon: Repeat, route: "/facility_admin/turnover" },
      { name: "Community & Events", icon: CalendarDays, route: "/facility_admin/community" },
      // Core LCMS Modules Aligned
      { name: "Assessment & Level of Care", icon: ClipboardList, route: "/facility_admin/rounds" },
      { name: "Care Planning", icon: Target, route: "/facility_admin/careplans" },
      { name: "Daily Care Documentation & Monitoring", icon: CheckCircle, route: "/facility_admin/tasks" },
      { name: "Vaccinations", icon: Syringe, route: "/facility_admin/vaccinations" },
      { name: "Resident Documents", icon: FolderOpen, route: "/facility_admin/documents" },
      { name: "Medication Administration Record", icon: Pill, route: "/facility_admin/mar" },
      { name: "Follow-up Tracker", icon: CalendarCheck, route: "/facility_admin/followups" },
      { name: "Audit Log", icon: Shield, route: "/facility_admin/auditlog" },
      { name: "Inventory Alerts", icon: Bell, route: "/facility_admin/inventory-alerts" },
      { name: "Clinical Reports", icon: BarChart3, route: "/facility_admin/clinicalreports" },
    ],
  },
  PHYSICIAN: {
    name: "Physician",
    badge: "Medical Authority",
    desc: "Oversee the whole care team: diagnose, prescribe & sign, set care directives, answer consults, and review the patient, family, nurse & caregiver record.",
    icon: Stethoscope,
    profileName: "Dr. Alan Reyes",
    basePath: "/physician",
    footerText: "Physician Medical Portal",
    sidebarLinks: [
      { name: "Reporting & Care Intelligence", icon: Grid, route: "/physician/dashboard" },
      { name: "Daily Rounds (10-Area Bedside)", icon: ClipboardCheck, route: "/physician/dailyrounds" },
      { name: "Assessment & Level of Care", icon: ClipboardList, route: "/physician/casereview" },
      { name: "Medication Management & Inventory", icon: Pill, route: "/physician/orders" },
      { name: "Care Planning", icon: Target, route: "/physician/careplans" },
      { name: "Consults & Referrals", icon: BookOpen, route: "/physician/consults" },
      { name: "Incident Medical Review", icon: AlertTriangle, route: "/physician/incidents" },
      { name: "Clinical Coordination", icon: Siren, route: "/physician/escalations" },
      { name: "Clinical Notes", icon: PenTool, route: "/physician/notes" },
      { name: "Secure Messages", icon: MessageSquare, route: "/physician/messages" },
      // Core LCMS Modules Aligned
      { name: "Resident Profile & Care Record", icon: ShieldCheck, route: "/physician/records" },
      { name: "Daily Care Documentation & Monitoring", icon: CheckCircle, route: "/physician/tasks" },
      { name: "Shift Endorsement & Continuity", icon: FileText, route: "/physician/reports" },
      { name: "Vaccinations", icon: Syringe, route: "/physician/vaccinations" },
      { name: "Resident Documents", icon: FolderOpen, route: "/physician/documents" },
      { name: "Medication Administration Record", icon: Pill, route: "/physician/mar" },
      { name: "Follow-up Tracker", icon: CalendarCheck, route: "/physician/followups" },
      { name: "Audit Log", icon: Shield, route: "/physician/auditlog" },
    ],
  },
  RESIDENT: {
    name: "Resident / Patient",
    badge: "My Care",
    desc: "View your own health timeline, daily reports, messages, and appointments.",
    icon: UserRound,
    profileName: "Arthur Pendelton",
    basePath: "/resident",
    footerText: "Resident My Care Portal",
    sidebarLinks: [
      { name: "Reporting & Care Intelligence", icon: Grid, route: "/resident/dashboard" },
      { name: "Daily Care Documentation & Monitoring", icon: CheckCircle, route: "/resident/report" },
      { name: "Messages", icon: MessageSquare, route: "/resident/messages" },
      { name: "Appointments", icon: Clock, route: "/resident/appointments" },
      { name: "Transport", icon: Bus, route: "/resident/transport" },
      { name: "Hotel Services", icon: ConciergeBell, route: "/resident/services" },
      { name: "Community & Events", icon: CalendarDays, route: "/resident/community" },
      // Core LCMS Modules Aligned
      { name: "Resident Profile & Care Record", icon: ShieldCheck, route: "/resident/records" },
      { name: "Assessment & Level of Care", icon: ClipboardList, route: "/resident/rounds" },
      { name: "Care Planning", icon: Target, route: "/resident/careplans" },
      { name: "Shift Endorsement & Continuity", icon: FileText, route: "/resident/reports" },
      { name: "Medication Management & Inventory", icon: Pill, route: "/resident/medications" },
      { name: "Clinical Coordination", icon: Siren, route: "/resident/escalations" },
      { name: "Vaccinations", icon: Syringe, route: "/resident/vaccinations" },
      { name: "Resident Documents", icon: FolderOpen, route: "/resident/documents" },
      { name: "Clinical Reports", icon: BarChart3, route: "/resident/clinicalreports" },
    ],
  },
  FLEET_MANAGEMENT: {
    name: "Fleet Manager",
    badge: "Fleet & Transport",
    desc: "Dispatch resident transport, track live trips, and keep the vehicle fleet compliant and road-ready.",
    icon: Bus,
    profileName: "Marcus Dela Cruz",
    basePath: "/fleet_management",
    footerText: "Fleet & Transport Portal",
    sidebarLinks: [
      { name: "Fleet Dashboard", icon: Grid, route: "/fleet_management/dashboard" },
      { name: "Transport Requests", icon: ClipboardList, route: "/fleet_management/requests" },
      { name: "Trip Board", icon: Route, route: "/fleet_management/trips" },
      { name: "Vehicles", icon: Car, route: "/fleet_management/vehicles" },
      { name: "Drivers", icon: Users, route: "/fleet_management/drivers" },
      { name: "Fleet Maintenance", icon: Wrench, route: "/fleet_management/maintenance" },
      { name: "Fuel & Odometer", icon: Fuel, route: "/fleet_management/fuel" },
      // Core LCMS Modules Aligned
      { name: "Resident Profile & Care Record", icon: ShieldCheck, route: "/fleet_management/records" },
      { name: "Assessment & Level of Care", icon: ClipboardList, route: "/fleet_management/rounds" },
      { name: "Care Planning", icon: Target, route: "/fleet_management/careplans" },
      { name: "Daily Care Documentation & Monitoring", icon: CheckCircle, route: "/fleet_management/tasks" },
      { name: "Shift Endorsement & Continuity", icon: FileText, route: "/fleet_management/reports" },
      { name: "Medication Management & Inventory", icon: Pill, route: "/fleet_management/medications" },
      { name: "Clinical Coordination", icon: Siren, route: "/fleet_management/escalations" },
    ],
  },
  DRIVER: {
    name: "Transport Driver",
    badge: "Logistics",
    desc: "Perform vehicle safety inspections, log odometer and fuel, and manage active transport requests.",
    icon: Car,
    profileName: "Eduardo Lopez",
    basePath: "/driver",
    footerText: "Driver Dispatch Portal",
    sidebarLinks: [
      { name: "Shift Dashboard", icon: Grid, route: "/driver/dashboard" },
      { name: "Trip Board", icon: Route, route: "/driver/trips" },
      { name: "Inspection Checklist", icon: ClipboardList, route: "/driver/checklist" },
      { name: "Fuel & Odometer", icon: Fuel, route: "/driver/fuel" },
      // Core LCMS Modules Aligned
      { name: "Resident Profile & Care Record", icon: ShieldCheck, route: "/driver/records" },
      { name: "Assessment & Level of Care", icon: ClipboardList, route: "/driver/rounds" },
      { name: "Care Planning", icon: Target, route: "/driver/careplans" },
      { name: "Daily Care Documentation & Monitoring", icon: CheckCircle, route: "/driver/tasks" },
      { name: "Shift Endorsement & Continuity", icon: FileText, route: "/driver/reports" },
      { name: "Medication Management & Inventory", icon: Pill, route: "/driver/medications" },
      { name: "Clinical Coordination", icon: Siren, route: "/driver/escalations" },
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// Sidebar grouping — mirrors the LCMS Feature Matrix modules so the
// nav renders as collapsible "group selections" instead of one long
// flat list. SIDEBAR_GROUP_ORDER defines the order groups appear in.
// ─────────────────────────────────────────────────────────────
export const SIDEBAR_GROUP_ORDER = [
  "Overview",
  "Resident Care",
  "Medication",
  "Coordination & Comms",
  "Operations",
  "Hospitality & Services",
  "Fleet & Transport",
  "Administration",
] as const;

export type SidebarGroup = (typeof SIDEBAR_GROUP_ORDER)[number];

const LINK_GROUP_MAP: Record<string, SidebarGroup> = {
  // Overview
  "Reporting & Care Intelligence": "Overview",
  "Fleet Dashboard": "Overview",
  "Shift Dashboard": "Overview",
  // Resident Care (Modules 1–4)
  "Resident Profile & Care Record": "Resident Care",
  "Daily Rounds (10-Area Bedside)": "Resident Care",
  "Assessment & Level of Care": "Resident Care",
  "Care Planning": "Resident Care",
  "Daily Care Documentation & Monitoring": "Resident Care",
  "Vaccinations": "Resident Care",
  "Resident Documents": "Resident Care",
  // Medication (Module 6)
  "Medication Management & Inventory": "Medication",
  "Medication Administration Record": "Medication",
  "Orders & Prescriptions": "Medication",
  "Inventory Alerts": "Medication",
  // Coordination & Comms (Modules 5, 7)
  "Clinical Coordination": "Coordination & Comms",
  "Care Team": "Coordination & Comms",
  "Call Bells": "Coordination & Comms",
  "Shift Endorsement & Continuity": "Coordination & Comms",
  "Consults & Referrals": "Coordination & Comms",
  "Follow-up Tracker": "Coordination & Comms",
  "Clinical Notes": "Coordination & Comms",
  "Secure Messages": "Coordination & Comms",
  "Messages": "Coordination & Comms",
  "Alerts": "Coordination & Comms",
  "Appointments": "Coordination & Comms",
  // Operations (facility, staff, incidents, billing, reports)
  "Staff Registry": "Operations",
  "Staff": "Operations",
  "Time Clock": "Operations",
  "Admissions & Registration": "Operations",
  "Rooms": "Operations",
  "Occupancy": "Operations",
  "Incidents": "Operations",
  "Incident Review": "Operations",
  "Incident Medical Review": "Operations",
  "Billing": "Operations",
  "Clinical Reports": "Operations",
  // Hospitality & Services (Module 14 — PMS)
  "Dining & Compliance": "Hospitality & Services",
  "Resident Services": "Hospitality & Services",
  "Hotel Services": "Hospitality & Services",
  "Concierge": "Hospitality & Services",
  "Front Desk": "Hospitality & Services",
  "Unit Turnover": "Hospitality & Services",
  "Community & Events": "Hospitality & Services",
  "Facility Maintenance": "Hospitality & Services",
  "Transport": "Hospitality & Services",
  // Fleet & Transport (Module 13)
  "Transport Requests": "Fleet & Transport",
  "Trip Board": "Fleet & Transport",
  "Vehicles": "Fleet & Transport",
  "Drivers": "Fleet & Transport",
  "Fleet Maintenance": "Fleet & Transport",
  "Fuel & Odometer": "Fleet & Transport",
  "Inspection Checklist": "Fleet & Transport",
  // Administration (governance, system tools)
  "LCMS Feature Matrix": "Administration",
  "AI Assistant": "Administration",
  "Landing Studio": "Administration",
  "Portal Matrix": "Administration",
  "Audit Log": "Administration",
};

export const getSidebarGroup = (linkName: string): SidebarGroup =>
  LINK_GROUP_MAP[linkName] || "Overview";

/**
 * Group an ordered list of sidebar links into matrix-based sections,
 * preserving each link's original order within its group and dropping
 * any group that has no links for the current role/matrix.
 */
export const groupSidebarLinks = (
  links: SidebarLink[]
): { group: SidebarGroup; links: SidebarLink[] }[] => {
  const buckets = new Map<SidebarGroup, SidebarLink[]>();
  for (const link of links) {
    const g = getSidebarGroup(link.name);
    const bucket = buckets.get(g);
    if (bucket) bucket.push(link);
    else buckets.set(g, [link]);
  }
  return SIDEBAR_GROUP_ORDER.filter((g) => buckets.has(g)).map((g) => ({
    group: g,
    links: buckets.get(g)!,
  }));
};

export const getRoleDetails = (role: Role): RoleDetails => {
  return ROLES[role] || ROLES.FAMILY;
};

export const getRoleFromPath = (pathSegment: string): Role => {
  return PATH_TO_ROLE[pathSegment] || "FAMILY";
};

export const getTabName = (tabSegment: string): string => {
  return ROUTE_TO_TAB[tabSegment] || "Dashboard";
};

export interface FeatureInfo {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  routeSegment: string;
}

export const GLOBAL_FEATURES: Record<string, FeatureInfo> = {
  "Reporting & Care Intelligence": { name: "Reporting & Care Intelligence", icon: Grid, routeSegment: "dashboard" },
  "Resident Profile & Care Record": { name: "Resident Profile & Care Record", icon: ShieldCheck, routeSegment: "records" },
  "Assessment & Level of Care": { name: "Assessment & Level of Care", icon: ClipboardList, routeSegment: "rounds" },
  "Medication Management & Inventory": { name: "Medication Management & Inventory", icon: Pill, routeSegment: "medications" },
  "Care Planning": { name: "Care Planning", icon: Target, routeSegment: "careplans" },
  "Clinical Coordination": { name: "Clinical Coordination", icon: Siren, routeSegment: "escalations" },
  "Shift Endorsement & Continuity": { name: "Shift Endorsement & Continuity", icon: FileText, routeSegment: "reports" },
  "Daily Care Documentation & Monitoring": { name: "Daily Care Documentation & Monitoring", icon: CheckCircle, routeSegment: "tasks" },
  "Admissions & Registration": { name: "Admissions & Registration", icon: UserPlus, routeSegment: "admissions" },
  "Staff Registry": { name: "Staff Registry", icon: Users, routeSegment: "staff" },
  "Staff": { name: "Staff", icon: Users, routeSegment: "staff" },
  "AI Assistant": { name: "AI Assistant", icon: Sparkles, routeSegment: "assistant" },
  "Landing Studio": { name: "Landing Studio", icon: Palette, routeSegment: "appearance" },
  "Portal Matrix": { name: "Portal Matrix", icon: ShieldCheck, routeSegment: "matrix" },
  "Incident Log": { name: "Incident Log", icon: AlertTriangle, routeSegment: "incidents" },
  "Incidents": { name: "Incidents", icon: AlertTriangle, routeSegment: "incidents" },
  "Time Clock": { name: "Time Clock", icon: Timer, routeSegment: "timeclock" },
  "Alerts": { name: "Alerts", icon: AlertTriangle, routeSegment: "alerts" },
  "Messages": { name: "Messages", icon: MessageSquare, routeSegment: "messages" },
  "Appointments": { name: "Appointments", icon: Clock, routeSegment: "appointments" },
  "Billing": { name: "Billing", icon: DollarSign, routeSegment: "billing" },
  "Expenses": { name: "Expenses", icon: DollarSign, routeSegment: "expenses" },
  "Rooms": { name: "Rooms", icon: DoorOpen, routeSegment: "rooms" },
  "Occupancy": { name: "Occupancy", icon: BedDouble, routeSegment: "occupancy" },
  "Call Bells": { name: "Call Bells", icon: BellRing, routeSegment: "callbells" },
  "Care Team": { name: "Care Team", icon: Stethoscope, routeSegment: "careteam" },
  "Transport Requests": { name: "Transport Requests", icon: ClipboardList, routeSegment: "requests" },
  "Trip Board": { name: "Trip Board", icon: Route, routeSegment: "trips" },
  "Vehicles": { name: "Vehicles", icon: Car, routeSegment: "vehicles" },
  "Drivers": { name: "Drivers", icon: Users, routeSegment: "drivers" },
  "Fleet Maintenance": { name: "Fleet Maintenance", icon: Wrench, routeSegment: "maintenance" },
  "Fuel & Odometer": { name: "Fuel & Odometer", icon: Fuel, routeSegment: "fuel" },
  "Transport": { name: "Transport", icon: Bus, routeSegment: "transport" },
  "Dining & Compliance": { name: "Dining & Compliance", icon: Utensils, routeSegment: "dining" },
  "Resident Services": { name: "Resident Services", icon: Ticket, routeSegment: "services" },
  "Concierge": { name: "Concierge", icon: ConciergeBell, routeSegment: "concierge" },
  "Hotel Services": { name: "Hotel Services", icon: ConciergeBell, routeSegment: "services" },
  "Front Desk": { name: "Front Desk", icon: DoorOpen, routeSegment: "frontdesk" },
  "Unit Turnover": { name: "Unit Turnover", icon: Repeat, routeSegment: "turnover" },
  "Community & Events": { name: "Community & Events", icon: CalendarDays, routeSegment: "community" },
  "Orders & Prescriptions": { name: "Orders & Prescriptions", icon: Pill, routeSegment: "orders" },
  "Clinical Notes": { name: "Clinical Notes", icon: PenTool, routeSegment: "notes" },
  "Incident Review": { name: "Incident Review", icon: AlertTriangle, routeSegment: "incidents" },
  "Secure Messages": { name: "Secure Messages", icon: MessageSquare, routeSegment: "messages" },
  "Case Review": { name: "Case Review", icon: ClipboardList, routeSegment: "casereview" },
  "Consults & Referrals": { name: "Consults & Referrals", icon: BookOpen, routeSegment: "consults" },
  "Incident Medical Review": { name: "Incident Medical Review", icon: AlertTriangle, routeSegment: "incidents" },
  "Vaccinations": { name: "Vaccinations", icon: Syringe, routeSegment: "vaccinations" },
  "Resident Documents": { name: "Resident Documents", icon: FolderOpen, routeSegment: "documents" },
  "Medication Administration Record": { name: "Medication Administration Record", icon: Pill, routeSegment: "mar" },
  "Follow-up Tracker": { name: "Follow-up Tracker", icon: CalendarCheck, routeSegment: "followups" },
  "Audit Log": { name: "Audit Log", icon: Shield, routeSegment: "auditlog" },
  "Inventory Alerts": { name: "Inventory Alerts", icon: Bell, routeSegment: "inventory-alerts" },
  "Clinical Reports": { name: "Clinical Reports", icon: BarChart3, routeSegment: "clinicalreports" },
  "Daily Rounds (10-Area Bedside)": { name: "Daily Rounds (10-Area Bedside)", icon: ClipboardCheck, routeSegment: "dailyrounds" },
  "LCMS Feature Matrix": { name: "LCMS Feature Matrix", icon: ShieldCheck, routeSegment: "featurematrix" },
};
