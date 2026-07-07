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
  Target,
} from "lucide-react";

export type Role = "SUPERADMIN" | "NURSE" | "CAREGIVER" | "FAMILY";

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
};

export const PATH_TO_ROLE: Record<string, Role> = {
  nurse: "NURSE",
  superadmin: "SUPERADMIN",
  caregiver: "CAREGIVER",
  family: "FAMILY",
};

export const ROLES: Record<Role, RoleDetails> = {
  SUPERADMIN: {
    name: "Super Admin",
    badge: "Operations",
    desc: "Oversee entire facility operations, manage staff registries, and monitor system health telemetry.",
    icon: Settings,
    profileName: "System Admin",
    basePath: "/superadmin",
    footerText: "Golden Hearth Operations Portal • System Node: 104-Admin • SSL Secure Connection",
    sidebarLinks: [
      { name: "Admin Dashboard", icon: Grid, route: "/superadmin/dashboard" },
      { name: "Staff Registry", icon: Users, route: "/superadmin/staff" },
    ],
  },
  NURSE: {
    name: "Head Nurse",
    badge: "Clinical Care",
    desc: "Access real-time resident vitals, receive instant fall detection warnings, and log via Voice AI.",
    icon: Activity,
    profileName: "Sarah Jenkins, RN",
    basePath: "/nurse",
    footerText: "Golden Hearth Resident Care Portal • Station: Nurse-3 • Resident Data Encryption Active",
    sidebarLinks: [
      { name: "Clinical Dashboard", icon: Grid, route: "/nurse/dashboard" },
      { name: "Vitals Monitor", icon: Activity, route: "/nurse/monitoring" },
      { name: "Incident Log", icon: AlertTriangle, route: "/nurse/incidents" },
      { name: "Resident Records", icon: ShieldCheck, route: "/nurse/records" },
    ],
  },
  CAREGIVER: {
    name: "On-Duty Caregiver",
    badge: "Daily Assistance",
    desc: "View resident assist checklists, check off task logs, and alert clinical staff of incidents.",
    icon: Users,
    profileName: "Caleb Randall",
    basePath: "/caregiver",
    footerText: "Golden Hearth Assistance Portal • Caregiver ID: CR-8854 • Shift Status: Active",
    sidebarLinks: [
      { name: "Shift Dashboard", icon: Grid, route: "/caregiver/dashboard" },
      { name: "Task Checklist", icon: CheckCircle, route: "/caregiver/tasks" },
      { name: "Resident Status", icon: Users, route: "/caregiver/residents" },
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
    footerText: "Golden Hearth Family Space • Relative: Arthur Pendelton • Fully Secure & Private",
    sidebarLinks: [
      { name: "Family Dashboard", icon: Grid, route: "/family/dashboard" },
      { name: "My Relative", icon: User, route: "/family/relative" },
      { name: "Daily Report", icon: CheckCircle, route: "/family/report" },
      { name: "Alerts", icon: AlertTriangle, route: "/family/alerts" },
      { name: "Messages", icon: MessageSquare, route: "/family/messages" },
      { name: "Photos", icon: ShieldCheck, route: "/family/photos" },
      { name: "Appointments", icon: Clock, route: "/family/appointments" },
      { name: "Billing", icon: DollarSign, route: "/family/expenses" },
      { name: "Care Goals", icon: Target, route: "/family/goals" },
      { name: "Health Timeline", icon: Activity, route: "/family/timeline" },
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
