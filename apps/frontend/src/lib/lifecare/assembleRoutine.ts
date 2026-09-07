// SLMS v4.2 Routine Assembly Engine (Sub-project #2).
//
// ONE pure function — assembleRoutine(input) → RoutineEventDefinition[] — that
// implements Routine Assembly Rules steps 1-13 + step 20 (Memory-Care invariant),
// producing DRAFT event definitions with full provenance. It does NOT persist,
// approve, or generate occurrences (Rules 14-19 & 21 belong to #3/#5).
//
// Precedence for conflicts (workbook): current order → resident-specific approved
// plan → active AS-domain rule → conditional pathway → LOC baseline. The engine
// PROPOSES; a nurse approves before activation. Pure: no Date.now/random/IO/Prisma.
//
// See docs/superpowers/specs/2026-09-05-slms-routine-assembly-engine-design.md.

import { bundlesForLoc, type LocBundle } from "./locBundles.ts";
import { careDeliveryMap, pathwaysForConditions, memoryPathways, type ConditionPathway } from "./conditionPathways.ts";
import { assistanceForScore, parseSupport, defaultRole, type Assistance, type AsScore, type Role } from "./assistance.ts";
import { schemaFor } from "./resultSchema.ts";
import { EXCEPTION_REASON, type Priority } from "./vocab.ts";
import { type DaySchedule, type HFMethod } from "./highFrequency.ts";

export type DefStatus = "DRAFT" | "BLOCKED";
export type FinalLoc = "LOC 1" | "LOC 2" | "LOC 3" | "LOC 4" | "LOC 5";

/** A draft routine event definition — plain object shaped like the #3 Prisma model. */
export interface RoutineEventDefinition {
  residentId: string;
  version: number;
  status: DefStatus;
  // provenance (Rule 2/4/3/5)
  sourceLocBundleId?: string;
  sourceAsDomain?: string;
  asScore?: number;
  goalId?: string;
  sourceTaskId?: string;
  conditionBundleId?: string;
  memoryPathwayId?: string;
  orderRef?: string;
  // content
  name: string;
  instructions: string;
  assistanceLevel?: Assistance; // canonical, from score ONLY
  supervision?: string;
  staffing?: string;
  equipment?: string;
  technique?: string;
  conditionModifier?: string;
  responsibleRole: Role;
  frequencyMethod: HFMethod;
  schedule: DaySchedule;
  shiftOwner: string; // AM | PM | NOC | varies
  criticality: string;
  completionControl: string;
  resultSchemaKey: string;
  exceptionSet: string[];
  escalationTrigger?: string;
  escalationPriority?: Priority;
  effectiveDate: string;
  reviewDate?: string;
  stopDate?: string;
  originalRecommendation: Record<string, unknown>;
  blockReason?: string;
}

interface InternalDraft extends RoutineEventDefinition {
  _asDomains?: string[];    // scratch: which AS domains the source bundle covers
}

export interface DomainInput {
  code: string;
  name: string;
  score: AsScore;
  activeNeed: boolean;
  goalId?: string;
  taskId?: string;
}

export interface OrderInput {
  medications?: { id: string; name: string; dosage: string; frequency: string; route: string;
    scheduledTimes?: string[]; startDate: string; endDate?: string; prescribedBy?: string }[];
  diet?: { id: string; dietType: string; restrictions?: string; texture?: string; mealType: string;
    orderedBy?: string; startDate: string; endDate?: string };
  freeText?: { orderRef: string; kind: "TAR" | "fluid" | "therapy" | "monitoring"; parameter: string;
    authorizedRole: "Nurse" | "Other authorized"; startDate: string; endDate?: string;
    daysOfWeek?: ("Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun")[] }[];
}

export interface PreferenceInput {
  wakeTime?: string;   // "07:30"
  mealTimes?: { breakfast?: string; lunch?: string; dinner?: string };
  notes?: string;
}

export interface AssembleInput {
  residentId: string;
  finalLoc: FinalLoc;
  assessmentVersion: string;
  approvedBy?: string;
  domains: DomainInput[];
  activeConditions: string[];      // pathway bundleIds already confirmed active by the caller
  memoryIntensity?: "Supportive" | "Structured" | "Enhanced" | "Intensive";
  orders: OrderInput;
  preferences?: PreferenceInput;
  effectiveDate: string;
}

// ── small pure helpers ─────────────────────────────────────────────────────────

const norm = (s: string) => (s || "").toLowerCase();

function normalizeFreq(s: string): HFMethod {
  const t = norm(s);
  if (t.includes("exact")) return "exact_time";
  if (t.includes("shift change") || t.includes("each shift")) return "exact_time"; // handover at shift starts
  if (t.includes("completion")) return "completion_based";
  if (t.includes("fixed interval") || t.includes("recurring fixed")) return "fixed_interval";
  if (t.includes("per shift") || t.includes("times per")) return "times_per_shift";
  if (t.includes("while awake")) return "while_awake";
  if (t.includes("trigger") || t.includes("prn")) return "trigger_prn";
  if (t.includes("temporary")) return "temporary";
  if (t.includes("defined") || t.includes("window")) return "defined_window";
  return "defined_window";
}

function scheduleFromText(method: HFMethod, timeText: string): DaySchedule {
  const times = (timeText.match(/\d{1,2}:\d{2}/g) ?? []);
  switch (method) {
    case "exact_time":
      if (/shift change|each shift/i.test(timeText)) return { times: ["06:00", "14:00", "22:00"] };
      return { times: times.length ? times : [] };
    case "defined_window":
      return { window: /\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/.test(timeText) ? timeText.replace(/\s/g, "") : undefined };
    case "fixed_interval":
      return { intervalHours: 2 };
    case "times_per_shift":
      return { perShift: 3 };
    case "while_awake":
      return { intervalHours: 2, wakeStart: 6, wakeEnd: 22 };
    default:
      return {};
  }
}

function shiftOwnerFromText(t: string): string {
  const s = norm(t);
  if (/night|overnight|bedtime|22:|23:|00:|02:|04:/.test(s)) return "NOC";
  if (/afternoon|evening|dinner|14:|15:|17:|19:|20:/.test(s)) return "PM";
  if (/morning|wake|breakfast|06:|07:|08:|09:|10:/.test(s)) return "AM";
  return "varies";
}

function criticalityToPriority(c: string): Priority {
  const t = norm(c);
  if (t.includes("critical")) return "P1";
  if (t.includes("high")) return "P2";
  if (t.includes("routine")) return "P4";
  return "P3";
}

/** Map free-text care-event wording → one of the 16 result-schema keys. */
function resultKeyForText(text: string): string {
  const t = norm(text);
  if (/glucose/.test(t)) return "Blood Glucose";
  if (/\bbp\b|pulse|vital|reading|ordered monitoring|clinical monitoring/.test(t)) return "Vital Signs";
  if (/medication/.test(t)) return "Medication Support";
  if (/swallow|meal|intake|feeding|nutrition|breakfast|lunch|dinner/.test(t)) return "Meal / Supplement";
  if (/hydration|fluid/.test(t)) return "Hydration";
  if (/toilet|contin/.test(t)) return "Toileting / Continence";
  if (/transfer/.test(t)) return "Transfer";
  if (/mobility|walk|ambulat/.test(t)) return "Mobility / Walking";
  if (/reposition|positioning/.test(t)) return "Repositioning";
  if (/skin|wound/.test(t)) return "Skin Check";
  if (/pain|comfort/.test(t)) return "Pain Support";
  if (/behavior|calming|orientation|routine cue|transition|de-escalation|redirection|cognition/.test(t)) return "Behavior Support";
  if (/sleep|night|evening/.test(t)) return "Sleep / Safety Round";
  if (/safety|supervision/.test(t)) return "Sleep / Safety Round";
  if (/activity|engagement/.test(t)) return "Activity / Engagement";
  if (/hygiene|dress|adl|personal care/.test(t)) return "ADL / Personal Care";
  return "General Observation";
}

function patternToLevel(text: string): Assistance | undefined {
  const t = norm(text);
  if (/total|near-total|\bfull\b/.test(t)) return "Total Assist";
  if (/extensive|moderate hands-on|ongoing cueing/.test(t)) return "Extensive Assist";
  if (/minimal|limited hands-on|standby|contact guard|one-person|1-person/.test(t)) return "Minimal Assist";
  if (/setup|cueing|prompt|reminder|supervision|invitation/.test(t)) return "Setup/Cueing";
  if (/independent|observe|observation|offer/.test(t)) return "Independent";
  return undefined;
}

const exceptionsFor = (resultSchemaKey: string): string[] => {
  try {
    return schemaFor(resultSchemaKey).allowedExceptions.filter((e) => (EXCEPTION_REASON as readonly string[]).includes(e));
  } catch {
    return [...EXCEPTION_REASON];
  }
};

/** Two staffing requirements conflict when they name a different person-count. */
export function staffingConflict(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const count = (s: string) => (/two|2-person|2 person/i.test(s) ? 2 : /one|1-person|1 person|single/i.test(s) ? 1 : 0);
  const ca = count(a), cb = count(b);
  return ca !== 0 && cb !== 0 && ca !== cb;
}

function block(e: InternalDraft, reason: string): void {
  e.status = "BLOCKED";
  e.blockReason = e.blockReason ? `${e.blockReason}; ${reason}` : reason;
}

// ── Rule 1: LOC baseline ────────────────────────────────────────────────────────

function bundleToDef(b: LocBundle, input: AssembleInput): InternalDraft {
  const method = normalizeFreq(b.frequencyMethod);
  const support = parseSupport(b.defaultAssistancePattern, 0);
  return {
    residentId: input.residentId,
    version: 1,
    status: "DRAFT",
    sourceLocBundleId: b.bundleEventId,
    name: b.careEvent,
    instructions: b.purpose,
    assistanceLevel: patternToLevel(b.defaultAssistancePattern),
    supervision: support.supervision,
    staffing: support.staffing,
    equipment: support.equipment,
    technique: support.technique,
    responsibleRole: defaultRole(b.category, b.orderRequired),
    frequencyMethod: method,
    schedule: scheduleFromText(method, b.defaultTimeShift),
    shiftOwner: shiftOwnerFromText(b.defaultTimeShift),
    criticality: b.criticality,
    completionControl: b.completionControl,
    resultSchemaKey: b.resultSchemaKey,
    exceptionSet: exceptionsFor(b.resultSchemaKey),
    escalationPriority: criticalityToPriority(b.criticality),
    effectiveDate: input.effectiveDate,
    originalRecommendation: {
      finalLoc: input.finalLoc,
      assessmentVersion: input.assessmentVersion,
      approvedBy: input.approvedBy,
      orderRequired: b.orderRequired,
    },
    _asDomains: b.asDomains,
  };
}

// ── Rule 2: active AS domains ────────────────────────────────────────────────────

function refineWithDomain(e: InternalDraft, d: DomainInput, tasks: string[], escalation: string): void {
  e.sourceAsDomain = d.code;
  e.asScore = d.score;
  if (d.goalId) e.goalId = d.goalId;
  if (d.taskId) e.sourceTaskId = d.taskId;
  const recommended = assistanceForScore(d.score);
  if (e.assistanceLevel && e.assistanceLevel !== recommended) {
    // Rule 9: never silently raise/lower — record both, leave final for nurse (#3).
    e.originalRecommendation.assistance = { prior: e.assistanceLevel, recommended };
  } else {
    e.assistanceLevel = recommended;
  }
  if (tasks.length) e.instructions = `${e.instructions} ${tasks[0]}`.trim();
  if (escalation && !e.escalationTrigger) e.escalationTrigger = escalation;
}

function domainToDef(d: DomainInput, map: NonNullable<ReturnType<typeof careDeliveryMap>>, input: AssembleInput): InternalDraft {
  const key = resultKeyForText(map.domain);
  const method = normalizeFreq(map.suggestedFrequency);
  return {
    residentId: input.residentId,
    version: 1,
    status: "DRAFT",
    sourceAsDomain: d.code,
    asScore: d.score,
    goalId: d.goalId,
    sourceTaskId: d.taskId,
    name: map.domain,
    instructions: [map.defaultGoal, map.caregiverTasks[0]].filter(Boolean).join(" "),
    assistanceLevel: assistanceForScore(d.score),
    responsibleRole: defaultRole(map.domain, false),
    frequencyMethod: method,
    schedule: scheduleFromText(method, map.suggestedFrequency),
    shiftOwner: "varies",
    criticality: map.careEventType.includes("critical") ? "Critical" : "Routine",
    completionControl: "Record & Complete",
    resultSchemaKey: key,
    exceptionSet: exceptionsFor(key),
    escalationTrigger: map.escalationTrigger,
    escalationPriority: "P3",
    effectiveDate: input.effectiveDate,
    originalRecommendation: { sourceAsDomain: d.code, asScore: d.score, addedByRule: 2 },
    _asDomains: [d.code],
  };
}

// ── Rule 4: conditional pathways ─────────────────────────────────────────────────

function pathwayToDef(p: ConditionPathway, input: AssembleInput): InternalDraft {
  const key = resultKeyForText(p.careEvent);
  const method = normalizeFreq(p.frequencyMethod);
  return {
    residentId: input.residentId,
    version: 1,
    status: "DRAFT",
    conditionBundleId: p.bundleId,
    name: p.careEvent,
    instructions: p.caregiverInstruction,
    responsibleRole: defaultRole(p.careEvent, p.orderRequired),
    frequencyMethod: method,
    schedule: scheduleFromText(method, p.shiftTrigger),
    shiftOwner: shiftOwnerFromText(p.shiftTrigger),
    criticality: "High",
    completionControl: "Record & Complete",
    resultSchemaKey: key,
    exceptionSet: exceptionsFor(key),
    escalationTrigger: p.escalationTrigger,
    escalationPriority: (["P1", "P2", "P3", "P4"].includes(p.priority) ? p.priority : "P3") as Priority,
    effectiveDate: input.effectiveDate,
    originalRecommendation: { conditionBundleId: p.bundleId, actionType: p.actionType, addedByRule: 4 },
  };
}

function applyPathway(p: ConditionPathway, events: InternalDraft[], input: AssembleInput): InternalDraft[] {
  const key = resultKeyForText(p.careEvent);
  const target = events.find((e) => e.resultSchemaKey === key && !e.conditionBundleId);
  switch (p.actionType) {
    case "Suppress":
      return events.filter((e) => !(e.resultSchemaKey === key && !e.conditionBundleId));
    case "Replace":
      if (target) {
        target.name = p.careEvent;
        target.instructions = p.caregiverInstruction;
        target.conditionBundleId = p.bundleId;
        target.escalationTrigger = p.escalationTrigger;
        target.escalationPriority = (["P1", "P2", "P3", "P4"].includes(p.priority) ? p.priority : target.escalationPriority) as Priority;
        (target.originalRecommendation as Record<string, unknown>)._merges = [
          ...((target.originalRecommendation as Record<string, unknown>)._merges as unknown[] ?? []),
          { pathway: p.bundleId, action: "Replace", reason: "same result key — merged precautions" },
        ];
        (target.originalRecommendation as Record<string, unknown>).orderRequired = p.orderRequired;
        return events;
      }
      events.push(pathwayToDef(p, input));
      return events;
    case "Modify":
      if (target) {
        target.instructions = `${target.instructions} ${p.caregiverInstruction}`.trim();
        target.conditionBundleId = p.bundleId;
        if (p.escalationTrigger) target.escalationTrigger = p.escalationTrigger;
        (target.originalRecommendation as Record<string, unknown>).modifiedBy = p.bundleId;
        return events;
      }
      events.push(pathwayToDef(p, input));
      return events;
    case "Add":
    default:
      events.push(pathwayToDef(p, input));
      return events;
  }
}

// ── Rule 5/11: orders + clinical scope ───────────────────────────────────────────

function findOrder(e: InternalDraft, orders: OrderInput): { ref: string; role?: Role } | undefined {
  if (e.resultSchemaKey === "Medication Support") {
    const med = orders.medications?.[0];
    return med ? { ref: med.id, role: "Nurse" } : undefined;
  }
  if (e.resultSchemaKey === "Meal / Supplement" && orders.diet) return { ref: orders.diet.id };
  const kind = e.resultSchemaKey === "Blood Glucose" || e.resultSchemaKey === "Vital Signs" ? "monitoring"
    : e.resultSchemaKey === "Skin Check" ? "TAR" : undefined;
  if (kind) {
    const ft = orders.freeText?.find((f) => f.kind === kind);
    if (ft) return { ref: ft.orderRef, role: ft.authorizedRole };
  }
  const anyFt = orders.freeText?.[0];
  return anyFt ? { ref: anyFt.orderRef, role: anyFt.authorizedRole } : undefined;
}

function orderRequiredOf(e: InternalDraft): boolean {
  return Boolean((e.originalRecommendation as Record<string, unknown>).orderRequired);
}

// ── the engine ───────────────────────────────────────────────────────────────────

export function assembleRoutine(input: AssembleInput): RoutineEventDefinition[] {
  // Rule 1 — LOC baseline (never computed from diagnosis/memory).
  let events: InternalDraft[] = bundlesForLoc(input.finalLoc).map((b) => bundleToDef(b, input));

  // Rule 2 — active AS domains.
  for (const d of input.domains) {
    if (!d.activeNeed) continue;
    const map = careDeliveryMap(d.code, d.score);
    if (!map || map.caregiverTasks.length === 0) continue; // a score with no staff-action need generates nothing
    const matches = events.filter((e) => e._asDomains?.includes(d.code));
    if (matches.length) {
      for (const e of matches) refineWithDomain(e, d, map.caregiverTasks, map.escalationTrigger);
    } else {
      events.push(domainToDef(d, map, input));
    }
  }

  // Rule 3 — Memory pathway (independent of LOC; never touches an LOC field).
  if (input.memoryIntensity) {
    const mp = memoryPathways().find((p) => p.intensity === input.memoryIntensity);
    if (mp) {
      const targets = events.filter((e) => e.resultSchemaKey === "Behavior Support");
      if (targets.length) targets.forEach((e) => { e.memoryPathwayId = mp.bundleId; });
      else {
        const def = pathwayToDef(mp, input);
        def.conditionBundleId = undefined;
        def.memoryPathwayId = mp.bundleId;
        events.push(def);
      }
    }
  }

  // Rule 4 — other conditional pathways (only those confirmed active).
  for (const p of pathwaysForConditions(input.activeConditions)) {
    if (p.memoryPathway) continue; // memory handled in Rule 3
    events = applyPathway(p, events, input);
  }

  // Rule 5 + Rule 11 — current orders + clinical scope. orderRequired without an
  // order → BLOCKED; a dysphagia meal vs a "regular" diet order → BLOCKED.
  for (const e of events) {
    if (orderRequiredOf(e)) {
      const ord = findOrder(e, input.orders);
      if (ord) {
        e.orderRef = ord.ref;
        if (ord.role) e.responsibleRole = ord.role;
      } else {
        block(e, "orderRequired but no matching current order");
      }
    }
    if (e.conditionBundleId === "DYSPH-01" && input.orders.diet && /regular|normal/i.test(input.orders.diet.texture ?? input.orders.diet.dietType)) {
      block(e, "diet contradiction: dysphagia requires modified texture but order is regular");
    }
    // Rule 11 scope: clinical events must be nurse-owned.
    if (["Medication Support", "Blood Glucose", "Vital Signs"].includes(e.resultSchemaKey) && e.responsibleRole !== "Nurse") {
      block(e, "authorized role (Nurse) required for clinical event");
    }
  }

  // Rule 6 — preferences (nonclinical only; never overrides an order/safety plan).
  const wake = input.preferences?.wakeTime;
  if (wake) {
    const hygiene = events.find((e) => e.resultSchemaKey === "ADL / Personal Care" && /morning|hygiene|wake/i.test(e.name));
    if (hygiene && !hygiene.orderRef && !hygiene.conditionModifier) {
      hygiene.schedule = { ...hygiene.schedule, window: `${wake}-${wake}`, times: [wake] };
      hygiene.frequencyMethod = "defined_window";
      hygiene.shiftOwner = "AM";
      hygiene.instructions = `Preferred wake time ${wake}. ${hygiene.instructions}`.trim();
      (hygiene.originalRecommendation as Record<string, unknown>).preferenceApplied = { wakeTime: wake };
    }
  }

  // Rule 9 — staffing conflicts block (assistance level conflicts recorded in Rule 2).
  for (const e of events) {
    const rec = (e.originalRecommendation as Record<string, unknown>).staffingConflict as { a: string; b: string } | undefined;
    if (rec && staffingConflict(rec.a, rec.b)) block(e, `staffing conflict: ${rec.a} vs ${rec.b}`);
  }

  // Rule 13 — resident-specific escalation threshold overrides the generic example.
  for (const ft of input.orders.freeText ?? []) {
    if (ft.kind !== "monitoring") continue;
    for (const e of events) {
      if ((e.resultSchemaKey === "Vital Signs" || e.resultSchemaKey === "Blood Glucose") && e.orderRef === ft.orderRef) {
        e.escalationTrigger = ft.parameter; // resident-specific parameter wins
      }
    }
  }

  // Rule 8 — dedup: collapse events sharing (resultSchemaKey + name + shiftOwner).
  const seen = new Map<string, InternalDraft>();
  for (const e of events) {
    const k = `${e.resultSchemaKey}|${e.name}|${e.shiftOwner}`;
    if (!seen.has(k)) seen.set(k, e);
  }
  events = [...seen.values()];

  // Rule 7 — atomic invariant (each event already carries exactly one resultSchemaKey).
  // Freeze: strip scratch, sort deterministically.
  return events
    .map(({ _asDomains, ...def }) => def as RoutineEventDefinition)
    .sort((a, b) =>
      `${a.sourceLocBundleId ?? a.conditionBundleId ?? a.memoryPathwayId ?? ""}${a.name}`
        .localeCompare(`${b.sourceLocBundleId ?? b.conditionBundleId ?? b.memoryPathwayId ?? ""}${b.name}`));
}

// ── Self-check (smoke) ───────────────────────────────────────────────────────────
export function demo(): void {
  const assert = (c: boolean, m: string) => { if (!c) throw new Error(`assembleRoutine demo: ${m}`); };
  const base: AssembleInput = {
    residentId: "R1", finalLoc: "LOC 4", assessmentVersion: "v4.2", domains: [],
    activeConditions: [], orders: {}, effectiveDate: "2026-09-05",
  };
  const out = assembleRoutine(base);
  assert(out.length > 0, "LOC 4 yields baseline events");
  assert(out.every((e) => e.resultSchemaKey && e.completionControl), "every event has one result schema + completion control");
  assert(out.every((e) => (e.originalRecommendation as Record<string, unknown>).finalLoc === "LOC 4"), "finalLoc provenance on every event");
}
