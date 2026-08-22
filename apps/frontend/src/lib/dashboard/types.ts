export type DashboardRole =
  | "nurse"
  | "caregiver"
  | "care-manager"
  | "facility-admin"
  | "resident-coordinator"
  | "professional";

export type DashboardPriority = "P1" | "P2" | "P3" | "P4";
export type ClinicalState = "STABLE" | "WATCH" | "ESCALATED";
export type MetricState = "GOOD" | "WATCH" | "ACTION";

export interface DashboardAction {
  type: "ACKNOWLEDGE_ASSIGNMENT" | "ACKNOWLEDGE_ESCALATION";
  label: string;
  entityId: string;
}

export interface DashboardQueueItem {
  id: string;
  kind: string;
  priority: DashboardPriority;
  state: ClinicalState;
  title: string;
  detail?: string;
  residentId?: string;
  residentLabel?: string;
  roomLabel?: string;
  ownerLabel?: string;
  dueAt?: string;
  occurredAt?: string;
  reason: string;
  sourceType: string;
  sourceId: string;
  sourceHref: string;
  photoUrl?: string;
  isNew?: boolean;
  action?: DashboardAction;
}

export interface DashboardSection {
  key: string;
  title: string;
  description: string;
  emptyTitle: string;
  emptyHint?: string;
  items: DashboardQueueItem[];
  limit?: number;
}

export interface DashboardMetric {
  key: string;
  label: string;
  display: string;
  numerator: number;
  denominator: number;
  numeratorLabel: string;
  denominatorLabel: string;
  window: string;
  exclusions: string[];
  definition: string;
  definitionVersion: string;
  threshold: string;
  baseline?: string;
  state: MetricState;
  sourceModels: string[];
  href: string;
}

export interface DashboardShift {
  key: "AM" | "PM" | "NOC";
  label: string;
  range: string;
  startsAt: string;
  endsAt: string;
  assignmentId?: string;
  assignmentAcknowledgedAt?: string;
}

export interface DashboardSummary {
  activeResidents: number;
  staffedNow: number;
  caregiversPresent?: number;
  pcgAssignments?: number;
  newOrReturningResidents?: number;
  nurseOnDuty?: string;
  residentsCovered: number;
  residentsUncovered: number;
  openEscalations: number;
  overdueWork: number;
  handoverStatus: "NOT_STARTED" | "PENDING" | "SIGNED_OFF" | "ACKNOWLEDGED";
  handoverId?: string;
  handoverLabel?: string;
}

export interface DashboardPayload {
  role: DashboardRole;
  title: string;
  subtitle: string;
  asOf: string;
  freshnessSeconds: number;
  serviceContext: "FACILITY";
  shift: DashboardShift;
  summary: DashboardSummary;
  metrics: DashboardMetric[];
  sections: DashboardSection[];
  residentChoices?: Array<{ id: string; label: string; room?: string }>;
  warnings: string[];
}
