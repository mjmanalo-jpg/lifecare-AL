// Phase 6 — Clinical Decision Trees (DT-001..DT-014) as structured, typed protocols.
//
// The dataset (dataset.ts → DECISION_TREES) carries only the register metadata for
// each tree ({id, name, domain, purpose, priority}). This module adds the *clinical
// protocol* for every tree: the trigger → pathway → documentation → escalation
// content that makes each tree actionable and defensible.
//
// Several trees are already realised by dedicated modules elsewhere in the app
// (fall/incidents, SBAR escalation, MAR, transport, care-event exception engine,
// reassessment). Those carry a `linkedModule` marker so the register board can show
// "realised in module X" rather than implying they need a new surface. The three
// trees with no existing home — DT-007 Safeguarding, DT-008 Infection/Outbreak and
// DT-010 Emergency/Evacuation — get first-class protocol boards in this phase.
//
// Pure + typed: no React, no I/O. Safe to import from tests and from server code.

import { DECISION_TREES, atomicRulesForTree } from "./dataset.ts";
import type { AtomicRule } from "./types.ts";

/** A single ordered step of a protocol pathway. */
export interface ProtocolStep {
  step: string;
  action: string;
}

/** An escalation rule: when `condition` holds, route `to`. */
export interface EscalationRule {
  condition: string;
  to: string;
}

/** The full clinical protocol for one decision tree. */
export interface Protocol {
  id: string;
  name: string;
  domain: string;
  purpose: string;
  /** Presenting signals / entry conditions that invoke the tree. */
  trigger: string[];
  /** Ordered decision/action pathway. */
  pathway: ProtocolStep[];
  /** What must be recorded (defensible documentation). */
  documentation: string[];
  /** Escalation matrix. */
  escalation: EscalationRule[];
  /** Set when the tree is operationalised by an existing module. */
  linkedModule?: string;
  /** Authoritative atomic business rules (BR-*) for this tree, from the workbook. */
  atomicRules?: AtomicRule[];
}

// Register metadata, keyed by id, so a protocol always mirrors the dataset's
// canonical name/domain/purpose (single source of truth for those three fields).
const REGISTER = new Map(DECISION_TREES.map((t) => [t.id, t]));

/** Build a Protocol, inheriting name/domain/purpose from the register. */
function proto(
  id: string,
  body: Omit<Protocol, "id" | "name" | "domain" | "purpose">,
): Protocol {
  const meta = REGISTER.get(id);
  return {
    id,
    name: meta?.name ?? id,
    domain: meta?.domain ?? "",
    purpose: meta?.purpose ?? "",
    ...body,
  };
}

// ─────────────────────────────────────────────────────────────
// DT-001 — Admission Suitability  (realised: admissions wizard)
// ─────────────────────────────────────────────────────────────
const DT_001 = proto("DT-001", {
  linkedModule: "admissions",
  trigger: [
    "New enquiry / referral for admission",
    "Requested services or documented risks exceed current shared-staffing capability",
    "Behavioural, clinical or safeguarding risk flagged at pre-admission",
  ],
  pathway: [
    { step: "Screen enquiry", action: "Capture reason for placement, funding and requested services." },
    { step: "Pre-admission assessment", action: "Complete Stage-2 scored assessment across the 14 domains." },
    { step: "Capability match", action: "Compare need + risk against facility capability, staffing and environment." },
    { step: "Decision", action: "Admit / conditional-admit with controls / decline-and-signpost." },
  ],
  documentation: [
    "Pre-admission assessment record",
    "Capability-match rationale and any conditions of admission",
    "Decision, decision-maker and date",
  ],
  escalation: [
    { condition: "Need or risk exceeds capability", to: "Care Manager / Facility Admin review before admit" },
    { condition: "Safeguarding concern surfaced at screening", to: "Safeguarding lead (DT-007)" },
  ],
});

// ─────────────────────────────────────────────────────────────
// DT-002 — Level of Care & Care Complexity  (realised: acuity engine)
// ─────────────────────────────────────────────────────────────
const DT_002 = proto("DT-002", {
  linkedModule: "careAcuity",
  trigger: [
    "Completed structured assessment awaiting level determination",
    "Minimum-level rule (MLR) or clinical modifier triggered",
  ],
  pathway: [
    { step: "Score domains", action: "Run the deterministic classifier over AS-01..AS-14." },
    { step: "Apply MLR floors", action: "Raise the suggested level to any minimum-level-rule floor." },
    { step: "Clinical validation", action: "Nurse confirms Final LOC; capability gate if L5 / instability." },
    { step: "Publish level", action: "Set Final LOC → generates care plan + LOC billing." },
  ],
  documentation: [
    "Domain scores and computed band",
    "Applied MLRs / modifiers and reasoning trace",
    "Final LOC, confirmed-by and date",
  ],
  escalation: [
    { condition: "Capability gate (L5 / acute instability)", to: "Capability review before publish" },
    { condition: "Clinician overrides computed level", to: "Documented override with rationale" },
  ],
});

// ─────────────────────────────────────────────────────────────
// DT-003 — Change in Condition  (realised: care-event / SBAR loop)
// ─────────────────────────────────────────────────────────────
const DT_003 = proto("DT-003", {
  linkedModule: "careEvents",
  trigger: [
    "New or worsening symptom vs baseline",
    "Abnormal vital sign or observation",
    "Care-event outcome flagged 'Clinical Change'",
  ],
  pathway: [
    { step: "Assess", action: "Baseline-compare vitals and observation; establish severity." },
    { step: "Stabilise", action: "Deliver immediate first-line care within competency." },
    { step: "Escalate", action: "Route via clinical escalation (DT-005) to nurse / physician." },
    { step: "Monitor", action: "Set review interval; re-assess and update the plan." },
  ],
  documentation: [
    "Baseline comparison and current findings",
    "Actions taken and resident response",
    "Escalation made and outcome",
  ],
  escalation: [
    { condition: "Acute deterioration / red-flag vitals", to: "Urgent clinical escalation (DT-005)" },
    { condition: "Repeated change / trend", to: "Care-level reassessment (DT-012)" },
  ],
});

// ─────────────────────────────────────────────────────────────
// DT-004 — Fall Response  (realised: fall detection + incidents)
// ─────────────────────────────────────────────────────────────
const DT_004 = proto("DT-004", {
  linkedModule: "incidents",
  trigger: [
    "Witnessed or unwitnessed fall",
    "Resident found on the floor",
    "Automated bed-exit / fall detection alert",
  ],
  pathway: [
    { step: "Do not move", action: "Approach, reassure; do NOT move until injury is assessed." },
    { step: "Assess injury", action: "Check responsiveness, head/neck/hip pain, bleeding, deformity." },
    { step: "Neuro / vitals", action: "Baseline vitals + neuro obs; suspect head injury if any doubt." },
    { step: "Escalate", action: "Nurse review; physician / 911 for suspected fracture, head injury or instability." },
    { step: "Post-fall", action: "Raise incident, review environment/cause, update falls-risk care plan." },
  ],
  documentation: [
    "Time, location, witnessed/unwitnessed, mechanism",
    "Injury assessment + neuro/vital observations",
    "Interventions, escalation and follow-up plan",
  ],
  escalation: [
    { condition: "Suspected head injury / LOC / fracture", to: "Physician / emergency services now" },
    { condition: "Recurrent falls", to: "Falls MDT review + reassessment (DT-012)" },
  ],
});

// ─────────────────────────────────────────────────────────────
// DT-005 — Clinical Escalation  (realised: EscalationsBoard / SBAR)
// ─────────────────────────────────────────────────────────────
const DT_005 = proto("DT-005", {
  linkedModule: "EscalationsBoard",
  trigger: [
    "Clinical concern requiring a decision above the reporter's scope",
    "Change in condition (DT-003) needing physician input",
    "Red-flag observation or unresolved risk",
  ],
  pathway: [
    { step: "Grade urgency", action: "Classify Routine / Urgent / Emergency and set the SLA." },
    { step: "SBAR", action: "Document Situation-Background-Assessment-Recommendation." },
    { step: "Route", action: "Send to physician / on-call per urgency; emergency → immediate call." },
    { step: "Close loop", action: "Acknowledge, record orders, resolve; log physician communication." },
  ],
  documentation: [
    "SBAR record and priority",
    "Who it was routed to and acknowledgement time",
    "Orders / response received and resolution",
  ],
  escalation: [
    { condition: "SLA breached / no response", to: "On-call / Facility Admin takeover" },
    { condition: "Emergency priority", to: "Immediate physician + emergency services (DT-009/DT-010)" },
  ],
});

// ─────────────────────────────────────────────────────────────
// DT-006 — Medication Variance  (realised: MAR / med compliance)
// ─────────────────────────────────────────────────────────────
const DT_006 = proto("DT-006", {
  linkedModule: "MAR",
  trigger: [
    "Missed, wrong, extra or wrong-time dose",
    "Medication refused or unavailable",
    "Suspected adverse drug reaction",
  ],
  pathway: [
    { step: "Assess resident", action: "Check for harm / adverse effect; treat symptoms first." },
    { step: "Contain", action: "Withhold further doses if unsafe; secure the medication." },
    { step: "Notify", action: "Inform nurse; physician/pharmacy for clinical significance." },
    { step: "Record variance", action: "Document on the MAR as a variance and complete an incident if harm/risk." },
    { step: "Review", action: "Root-cause review; update MAR / process to prevent recurrence." },
  ],
  documentation: [
    "Medication, dose, intended vs actual, time",
    "Resident effect and immediate actions",
    "Notifications made and corrective actions",
  ],
  escalation: [
    { condition: "Actual or potential harm", to: "Physician now + incident report" },
    { condition: "Repeated variance / system fault", to: "Medication safety review (pharmacy)" },
  ],
});

// ─────────────────────────────────────────────────────────────
// DT-007 — Safeguarding  (NEW board this phase: SafeguardingBoard)
// ─────────────────────────────────────────────────────────────
const DT_007 = proto("DT-007", {
  trigger: [
    "Suspected or disclosed abuse (physical, emotional, sexual)",
    "Suspected neglect or acts of omission",
    "Suspected financial exploitation or misappropriation",
    "Unexplained injury, sudden behaviour change, or fear of a person",
  ],
  pathway: [
    { step: "Ensure safety", action: "Make the resident safe now; remove/limit contact with the alleged source of harm." },
    { step: "Preserve evidence", action: "Do not wash, tidy or interfere; note exact words of any disclosure verbatim." },
    { step: "Immediate care", action: "Attend to medical needs; involve a physician / emergency services if injured." },
    { step: "Report internally", action: "Notify the safeguarding lead / Facility Admin without delay." },
    { step: "Report externally", action: "Refer to the statutory safeguarding authority and police where a crime is suspected." },
    { step: "Support & review", action: "Protection plan for the resident; cooperate with the investigation; review controls." },
  ],
  documentation: [
    "What was seen/heard, when, where and by whom (factual, verbatim disclosure)",
    "Immediate protection actions taken and by whom",
    "Internal report (lead notified) and external referral (authority + reference)",
    "Ongoing protection plan and confidentiality handling",
  ],
  escalation: [
    { condition: "Immediate danger or serious injury", to: "Emergency services + physician now" },
    { condition: "Suspected crime", to: "Police + statutory safeguarding authority" },
    { condition: "Any safeguarding concern", to: "Safeguarding lead / Facility Admin (report, do not investigate alone)" },
  ],
});

// ─────────────────────────────────────────────────────────────
// DT-008 — Infection / Outbreak  (NEW board: InfectionControlBoard)
// ─────────────────────────────────────────────────────────────
const DT_008 = proto("DT-008", {
  trigger: [
    "Resident with new signs of infection (fever, cough, D&V, rash, wound)",
    "Confirmed communicable infection (e.g. influenza, COVID-19, norovirus, C. difficile)",
    "Two or more linked cases in a unit/timeframe (possible outbreak)",
  ],
  pathway: [
    { step: "Isolate / cohort", action: "Place the resident on appropriate precautions; single room or cohort as needed." },
    { step: "Precautions", action: "Apply standard + transmission-based precautions (contact / droplet / airborne); PPE + hand hygiene." },
    { step: "Assess & test", action: "Clinically assess; obtain specimens/tests; treat per physician orders." },
    { step: "Notify", action: "Inform nurse, physician and infection-control lead; brief staff and update signage." },
    { step: "Declare outbreak", action: "If threshold met, declare an outbreak, notify public-health authority and open a line list." },
    { step: "Control & stand down", action: "Restrict movement/admissions as advised, enhance cleaning, monitor; stand down after clear period." },
  ],
  documentation: [
    "Case details, symptoms, onset and precaution type applied",
    "Tests ordered/results and treatment given",
    "Notifications (physician, IPC lead, public health) and any outbreak declaration",
    "Line list of linked cases and control measures + stand-down decision",
  ],
  escalation: [
    { condition: "Clinical deterioration", to: "Physician / hospital transfer (DT-009)" },
    { condition: "Outbreak threshold reached", to: "Infection-control lead + public-health authority" },
    { condition: "Facility-wide spread", to: "Facility Admin + emergency/continuity plan (DT-010)" },
  ],
});

// ─────────────────────────────────────────────────────────────
// DT-009 — Hospital Transfer  (realised: referrals + transport)
// ─────────────────────────────────────────────────────────────
const DT_009 = proto("DT-009", {
  linkedModule: "transport",
  trigger: [
    "Clinical need beyond facility capability",
    "Physician / emergency decision to transfer",
    "Injury or acute event requiring hospital care",
  ],
  pathway: [
    { step: "Decide", action: "Confirm transfer need and destination with the physician / emergency services." },
    { step: "Prepare handoff", action: "Assemble transfer pack: SBAR, meds list, allergies, advance directives, ID." },
    { step: "Arrange transport", action: "Raise a transport request / ambulance; notify family / sponsor." },
    { step: "Handover", action: "Verbal + written handover to the receiving team; record departure time." },
    { step: "Manage return", action: "On return, reconcile meds/orders, reassess and update the care plan." },
  ],
  documentation: [
    "Reason for transfer and decision-maker",
    "Transfer pack contents and handover given",
    "Family notification and return reconciliation",
  ],
  escalation: [
    { condition: "Life-threatening emergency", to: "Emergency services immediately (DT-010)" },
    { condition: "Significant change on return", to: "Reassessment / level change (DT-012)" },
  ],
});

// ─────────────────────────────────────────────────────────────
// DT-010 — Emergency / Evacuation  (NEW board: EmergencyProtocolBoard)
// ─────────────────────────────────────────────────────────────
const DT_010 = proto("DT-010", {
  trigger: [
    "Fire, flood, gas leak, structural or utility failure",
    "Severe weather, security threat or external emergency",
    "Any event making all or part of the facility unsafe to occupy",
  ],
  pathway: [
    { step: "Raise alarm", action: "Activate the alarm, call emergency services and alert the person-in-charge." },
    { step: "Assess & decide", action: "Decide SHELTER-IN-PLACE vs EVACUATE (partial/full) based on the threat." },
    { step: "Protect residents", action: "Move residents to safety per evacuation zones; prioritise by mobility/dependency." },
    { step: "Account for all", action: "Headcount residents + staff + visitors against the roster at the muster point." },
    { step: "Support & liaise", action: "Provide continuity of care/meds; brief responders; notify families." },
    { step: "Recovery / all-clear", action: "Only re-occupy on official all-clear; debrief and review the response." },
  ],
  documentation: [
    "Nature/time of emergency and shelter-vs-evacuate decision",
    "Evacuation actions and residents/areas affected",
    "Headcount / accountability result (all persons accounted for?)",
    "External agencies involved, all-clear time and post-incident debrief",
  ],
  escalation: [
    { condition: "Any life-safety emergency", to: "Emergency services (fire/medical/police) now" },
    { condition: "Person unaccounted for", to: "Immediate search + notify responders" },
    { condition: "Facility uninhabitable", to: "Business-continuity / relocation + Facility Admin" },
  ],
});

// ─────────────────────────────────────────────────────────────
// DT-011 — Care Task Exception  (realised: care-event exception engine)
// ─────────────────────────────────────────────────────────────
const DT_011 = proto("DT-011", {
  linkedModule: "careEvents",
  trigger: [
    "Planned care task missed, refused, unable or unsafe to complete",
    "Assistance level or frequency varied from the plan",
  ],
  pathway: [
    { step: "Chart exception", action: "Record the structured exception outcome instead of a 1-tap complete." },
    { step: "Classify", action: "Engine maps the outcome to notify-nurse / plan-review / incident." },
    { step: "Act", action: "Deliver the safest alternative; notify nurse where required." },
    { step: "Trend", action: "Increment the variance counter; raise a review alert at threshold." },
  ],
  documentation: [
    "Task, outcome and observation",
    "Assistance/frequency variance detail where applicable",
    "Escalation action taken",
  ],
  escalation: [
    { condition: "Unsafe / clinical-change outcome", to: "Incident / DT-003 change-in-condition" },
    { condition: "Repeated variance at threshold", to: "Care-plan / level reassessment (DT-012)" },
  ],
});

// ─────────────────────────────────────────────────────────────
// DT-012 — Care Level Change  (realised: reassessment)
// ─────────────────────────────────────────────────────────────
const DT_012 = proto("DT-012", {
  linkedModule: "reassessment",
  trigger: [
    "Sustained change in needs, ability or risk",
    "Variance counter / trend threshold reached",
    "Post-hospitalisation or major clinical event",
  ],
  pathway: [
    { step: "Flag review", action: "Open a reassessment triggered by the change or trend signal." },
    { step: "Reassess", action: "Re-score affected domains; capture current baseline and risks." },
    { step: "Re-determine LOC", action: "Recompute suggested level; nurse confirms new Final LOC (DT-002)." },
    { step: "Update plan & fee", action: "Regenerate care plan/tasks; adjust LOC billing on approval." },
  ],
  documentation: [
    "Trigger for reassessment",
    "Updated scores and rationale",
    "New Final LOC, approver and effective date",
  ],
  escalation: [
    { condition: "Needs exceed facility capability", to: "Admission suitability review (DT-001) / transfer" },
    { condition: "Dedicated staffing indicated", to: "Private caregiver determination (DT-013)" },
  ],
});

// ─────────────────────────────────────────────────────────────
// DT-013 — Dedicated Staffing / Private Caregiver  (realised: PCG board)
// ─────────────────────────────────────────────────────────────
const DT_013 = proto("DT-013", {
  linkedModule: "privateCaregiver",
  trigger: [
    "Needs cannot be met within the final LOC shared-staffing model",
    "1:1 supervision required (e.g. falls, elopement, behaviour)",
    "Family requests dedicated staffing",
  ],
  pathway: [
    { step: "Determine need", action: "Nurse assesses whether shared staffing is safe or 1:1 is required." },
    { step: "Family approval", action: "Present the dedicated-staffing plan and recurring cost for approval." },
    { step: "Assign", action: "Assign the private caregiver and schedule the 1:1 duty." },
    { step: "Bill & review", action: "Start recurring flat-fee billing; review need at each reassessment." },
  ],
  documentation: [
    "Clinical rationale for dedicated staffing",
    "Family approval and agreed cost",
    "Assignment, schedule and review date",
  ],
  escalation: [
    { condition: "Need resolves", to: "Step down to shared staffing at reassessment (DT-012)" },
  ],
});

// ─────────────────────────────────────────────────────────────
// DT-014 — Additional Clinical & Skilled Services  (realised: ACS pricing)
// ─────────────────────────────────────────────────────────────
const DT_014 = proto("DT-014", {
  linkedModule: "additionalServices",
  trigger: [
    "Change-of-condition intervention beyond included LOC nursing oversight",
    "Skilled / ancillary service requested (e.g. therapy, specialist procedure)",
    "Recurring package need identified",
  ],
  pathway: [
    { step: "Classify service", action: "Determine included-in-LOC vs separately chargeable vs package vs capability escalation." },
    { step: "Authorise", action: "Obtain clinical + family/financial authorisation where chargeable." },
    { step: "Deliver", action: "Provide the service; record delivery and resident response." },
    { step: "Bill & reassess", action: "Post the separate charge; reassess if the need becomes ongoing." },
  ],
  documentation: [
    "Service, classification and rationale",
    "Authorisation (clinical + financial)",
    "Delivery record and any recurring-package decision",
  ],
  escalation: [
    { condition: "Ongoing skilled need", to: "Package / level reassessment (DT-012)" },
    { condition: "Exceeds capability", to: "Admission suitability review (DT-001) / transfer" },
  ],
});

/** All 14 protocols keyed by decision-tree id. */
export const PROTOCOLS: Record<string, Protocol> = {
  "DT-001": DT_001, "DT-002": DT_002, "DT-003": DT_003, "DT-004": DT_004,
  "DT-005": DT_005, "DT-006": DT_006, "DT-007": DT_007, "DT-008": DT_008,
  "DT-009": DT_009, "DT-010": DT_010, "DT-011": DT_011, "DT-012": DT_012,
  "DT-013": DT_013, "DT-014": DT_014,
};

/** Lookup a protocol by decision-tree id (e.g. "DT-007"), enriched with its atomic BR-* rules. */
export function getProtocol(id: string): Protocol | undefined {
  const p = PROTOCOLS[id];
  if (!p) return undefined;
  return { ...p, atomicRules: atomicRulesForTree(id) };
}

/** All protocols in register order (DT-001..DT-014), each enriched with its atomic BR-* rules. */
export function allProtocols(): Protocol[] {
  return DECISION_TREES.map((t) => getProtocol(t.id)).filter(Boolean) as Protocol[];
}

/** Ids of the three trees given first-class protocol boards in this phase. */
export const NEW_BOARD_TREES = ["DT-007", "DT-008", "DT-010"] as const;
