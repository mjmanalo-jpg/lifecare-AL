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
  dashboard: "Clinical Dashboard",
  monitoring: "Vitals Monitor",
  incidents: "Incident Log",
  records: "Resident Records",
  staff: "Staff Registry",
  tasks: "Task Checklist",
  residents: "Resident Status",
  reports: "Shift Reports",
  relative: "My Relative",
  timeline: "Health Timeline",
  report: "Daily Report",
  alerts: "Alerts",
  messages: "Messages",
  photos: "Photos",
  appointments: "Appointments",
  expenses: "Billing",
  goals: "Care Goals",
  admin: "Admin Dashboard",
  shift: "Shift Dashboard",
  family: "Family Dashboard",
  appearance: "Landing Studio",
  assistant: "AI Assistant",
  matrix: "Portal Matrix",
  admissions: "Admissions",
  rooms: "Rooms",
  occupancy: "Occupancy",
  billing: "Billing",
  inventory: "Inventory",
  medications: "Medication Rounds",
  callbells: "Call Bells",
  timeclock: "Time Clock",
  rounds: "Patient Rounds",
  orders: "Orders & Prescriptions",
  notes: "Clinical Notes",
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
};

export const PATH_TO_ROLE: Record<string, Role> = {
  nurse: "NURSE",
  superadmin: "SUPERADMIN",
  caregiver: "CAREGIVER",
  family: "FAMILY",
  // New roles — keys MUST equal the Role enum lowercased (login redirects to
  // `/${role.toLowerCase()}/dashboard`, and the layout matches on this map).
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
      { name: "Admin Dashboard", icon: Grid, route: "/superadmin/dashboard" },
      { name: "Admissions", icon: UserPlus, route: "/superadmin/admissions" },
      { name: "Staff Registry", icon: Users, route: "/superadmin/staff" },
      { name: "AI Assistant", icon: Sparkles, route: "/superadmin/assistant" },
      { name: "Landing Studio", icon: Palette, route: "/superadmin/appearance" },
      { name: "Portal Matrix", icon: ShieldCheck, route: "/superadmin/matrix" },
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
      { name: "Clinical Dashboard", icon: Grid, route: "/nurse/dashboard" },
      { name: "Resident Records", icon: ShieldCheck, route: "/nurse/records" },
      { name: "Medication Rounds", icon: Pill, route: "/nurse/medications" },
      { name: "Incident Log", icon: AlertTriangle, route: "/nurse/incidents" },
      { name: "Shift Reports", icon: FileText, route: "/nurse/reports" },
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
      { name: "Shift Dashboard", icon: Grid, route: "/caregiver/dashboard" },
      { name: "Task Checklist", icon: CheckCircle, route: "/caregiver/tasks" },
      { name: "Care Team", icon: Stethoscope, route: "/caregiver/careteam" },
      { name: "Call Bells", icon: BellRing, route: "/caregiver/callbells" },
      { name: "Resident Status", icon: Users, route: "/caregiver/residents" },
      { name: "Time Clock", icon: Timer, route: "/caregiver/timeclock" },
      { name: "Shift Reports", icon: Clock, route: "/caregiver/reports" },
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
      { name: "Family Dashboard", icon: Grid, route: "/family/dashboard" },
      { name: "My Relative", icon: User, route: "/family/relative" },
      { name: "Daily Report", icon: CheckCircle, route: "/family/report" },
      { name: "Care Team", icon: Stethoscope, route: "/family/careteam" },
      { name: "Care Goals", icon: Target, route: "/family/goals" },
      { name: "Alerts", icon: AlertTriangle, route: "/family/alerts" },
      { name: "Messages", icon: MessageSquare, route: "/family/messages" },
      { name: "Appointments", icon: Clock, route: "/family/appointments" },
      { name: "Transport", icon: Bus, route: "/family/transport" },
      { name: "Billing", icon: DollarSign, route: "/family/expenses" },
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
      { name: "Facility Dashboard", icon: Grid, route: "/facility_admin/dashboard" },
      { name: "Residents", icon: UserRound, route: "/facility_admin/residents" },
      { name: "Staff", icon: Users, route: "/facility_admin/staff" },
      { name: "Rooms", icon: DoorOpen, route: "/facility_admin/rooms" },
      { name: "Occupancy", icon: BedDouble, route: "/facility_admin/occupancy" },
      { name: "Incidents", icon: AlertTriangle, route: "/facility_admin/incidents" },
      { name: "Inventory", icon: Package, route: "/facility_admin/inventory" },
      { name: "Reports", icon: FileText, route: "/facility_admin/reports" },
      { name: "Billing", icon: DollarSign, route: "/facility_admin/billing" },
      { name: "Dining & Compliance", icon: Utensils, route: "/facility_admin/dining" },
    ],
  },
  PHYSICIAN: {
    name: "Physician",
    badge: "Medical",
    desc: "Review resident vitals, medical records, and incident history; direct clinical care.",
    icon: Stethoscope,
    profileName: "Dr. Alan Reyes",
    basePath: "/physician",
    footerText: "Physician Medical Portal",
    sidebarLinks: [
      { name: "Clinical Dashboard", icon: Grid, route: "/physician/dashboard" },
      { name: "Patient Rounds", icon: ClipboardList, route: "/physician/rounds" },
      { name: "Medical Records", icon: BookOpen, route: "/physician/records" },
      { name: "Orders & Prescriptions", icon: Pill, route: "/physician/orders" },
      { name: "Clinical Notes", icon: PenTool, route: "/physician/notes" },
      { name: "Vitals Trends", icon: TrendingUp, route: "/physician/vitals" },
      { name: "Incident Review", icon: AlertTriangle, route: "/physician/incidents" },
      { name: "Messages", icon: MessageSquare, route: "/physician/messages" },
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
      { name: "My Dashboard", icon: Grid, route: "/resident/dashboard" },
      { name: "Daily Report", icon: CheckCircle, route: "/resident/report" },
      { name: "Messages", icon: MessageSquare, route: "/resident/messages" },
      { name: "Appointments", icon: Clock, route: "/resident/appointments" },
      { name: "Transport", icon: Bus, route: "/resident/transport" },
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
      { name: "Maintenance", icon: Wrench, route: "/fleet_management/maintenance" },
      { name: "Fuel & Odometer", icon: Fuel, route: "/fleet_management/fuel" },
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
    ],
  },
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
  "Admin Dashboard": { name: "Admin Dashboard", icon: Grid, routeSegment: "dashboard" },
  "Clinical Dashboard": { name: "Clinical Dashboard", icon: Grid, routeSegment: "dashboard" },
  "Shift Dashboard": { name: "Shift Dashboard", icon: Grid, routeSegment: "dashboard" },
  "Family Dashboard": { name: "Family Dashboard", icon: Grid, routeSegment: "dashboard" },
  "Facility Dashboard": { name: "Facility Dashboard", icon: Grid, routeSegment: "dashboard" },
  "My Dashboard": { name: "My Dashboard", icon: Grid, routeSegment: "dashboard" },
  "Admissions": { name: "Admissions", icon: UserPlus, routeSegment: "admissions" },
  "Staff Registry": { name: "Staff Registry", icon: Users, routeSegment: "staff" },
  "Staff": { name: "Staff", icon: Users, routeSegment: "staff" },
  "AI Assistant": { name: "AI Assistant", icon: Sparkles, routeSegment: "assistant" },
  "Landing Studio": { name: "Landing Studio", icon: Palette, routeSegment: "appearance" },
  "Portal Matrix": { name: "Portal Matrix", icon: ShieldCheck, routeSegment: "matrix" },
  "Resident Records": { name: "Resident Records", icon: ShieldCheck, routeSegment: "records" },
  "Residents": { name: "Residents", icon: UserRound, routeSegment: "residents" },
  "Resident Status": { name: "Resident Status", icon: Users, routeSegment: "residents" },
  "Medication Rounds": { name: "Medication Rounds", icon: Pill, routeSegment: "medications" },
  "Incident Log": { name: "Incident Log", icon: AlertTriangle, routeSegment: "incidents" },
  "Incidents": { name: "Incidents", icon: AlertTriangle, routeSegment: "incidents" },
  "Shift Reports": { name: "Shift Reports", icon: FileText, routeSegment: "reports" },
  "Reports": { name: "Reports", icon: FileText, routeSegment: "reports" },
  "Task Checklist": { name: "Task Checklist", icon: CheckCircle, routeSegment: "tasks" },
  "Time Clock": { name: "Time Clock", icon: Timer, routeSegment: "timeclock" },
  "My Relative": { name: "My Relative", icon: User, routeSegment: "relative" },
  "Daily Report": { name: "Daily Report", icon: CheckCircle, routeSegment: "report" },
  "Alerts": { name: "Alerts", icon: AlertTriangle, routeSegment: "alerts" },
  "Messages": { name: "Messages", icon: MessageSquare, routeSegment: "messages" },
  "Appointments": { name: "Appointments", icon: Clock, routeSegment: "appointments" },
  "Billing": { name: "Billing", icon: DollarSign, routeSegment: "billing" },
  "Expenses": { name: "Expenses", icon: DollarSign, routeSegment: "expenses" },
  "Rooms": { name: "Rooms", icon: DoorOpen, routeSegment: "rooms" },
  "Occupancy": { name: "Occupancy", icon: BedDouble, routeSegment: "occupancy" },
  "Inventory": { name: "Inventory", icon: Package, routeSegment: "inventory" },
  "Call Bells": { name: "Call Bells", icon: BellRing, routeSegment: "callbells" },
  "Vitals Monitor": { name: "Vitals Monitor", icon: Activity, routeSegment: "monitoring" },
  "Health Timeline": { name: "Health Timeline", icon: Activity, routeSegment: "timeline" },
  "Patient Rounds": { name: "Patient Rounds", icon: ClipboardList, routeSegment: "rounds" },
  "Orders & Prescriptions": { name: "Orders & Prescriptions", icon: Pill, routeSegment: "orders" },
  "Clinical Notes": { name: "Clinical Notes", icon: PenTool, routeSegment: "notes" },
  "Vitals Trends": { name: "Vitals Trends", icon: TrendingUp, routeSegment: "vitals" },
  "Incident Review": { name: "Incident Review", icon: AlertTriangle, routeSegment: "incidents" },
  "Medical Records": { name: "Medical Records", icon: BookOpen, routeSegment: "records" },
  "Care Team": { name: "Care Team", icon: Stethoscope, routeSegment: "careteam" },
  "Care Goals": { name: "Care Goals", icon: Target, routeSegment: "goals" },
  "Fleet Dashboard": { name: "Fleet Dashboard", icon: Grid, routeSegment: "dashboard" },
  "Transport Requests": { name: "Transport Requests", icon: ClipboardList, routeSegment: "requests" },
  "Trip Board": { name: "Trip Board", icon: Route, routeSegment: "trips" },
  "Vehicles": { name: "Vehicles", icon: Car, routeSegment: "vehicles" },
  "Drivers": { name: "Drivers", icon: Users, routeSegment: "drivers" },
  "Maintenance": { name: "Maintenance", icon: Wrench, routeSegment: "maintenance" },
  "Fuel & Odometer": { name: "Fuel & Odometer", icon: Fuel, routeSegment: "fuel" },
  "Transport": { name: "Transport", icon: Bus, routeSegment: "transport" },
  "Dining & Compliance": { name: "Dining & Compliance", icon: Utensils, routeSegment: "dining" },
};

