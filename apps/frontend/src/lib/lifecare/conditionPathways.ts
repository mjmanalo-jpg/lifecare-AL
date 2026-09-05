// SLMS v4.2 Conditional Bundle Activation + AS Care Delivery Map (Foundations unit C
// + supplementary table). Cross-LOC pathways that Add / Modify / Replace / Suppress
// baseline events, and the per-domain×score refinement map. Memory pathways are
// structurally decoupled from LOC (crossLoc + memoryPathway); a diagnosis/history
// alone never activates a task (see doesNotActivateFrom). Data extracted from (2).xlsx.

import pathwaysRaw from "./data/condition_pathways.json" with { type: "json" };
import mapRaw from "./data/as_care_delivery_map.json" with { type: "json" };

export interface ConditionPathway {
  bundleId: string;
  pathway: string;
  intensity: string;
  crossLoc: boolean;
  memoryPathway: boolean;
  linkedDomains: string[];
  activationCriteria: string;
  doesNotActivateFrom: string;
  actionType: string; // Modify | Add | Replace | Suppress
  careEvent: string;
  caregiverInstruction: string;
  frequencyMethod: string;
  shiftTrigger: string;
  requiredResult: string;
  orderRequired: boolean;
  escalationTrigger: string;
  priority: string; // P1..P4
  reviewStopRule: string;
  nursingApprovalRequired: boolean;
  sourceWorkbookVersion: string;
}

export interface CareDeliveryEntry {
  domainCode: string;
  domain: string;
  asLevel: number; // 0-4
  defaultGoal: string;
  caregiverTasks: string[];
  nurseOversight: string;
  suggestedFrequency: string;
  careEventType: string;
  escalationTrigger: string;
  activationRule: string;
  sourceWorkbookVersion: string;
}

export const ALL_CONDITION_PATHWAYS = pathwaysRaw as ConditionPathway[];
export const CARE_DELIVERY_MAP = mapRaw as CareDeliveryEntry[];

/**
 * Pathways whose condition is currently active. Match is by bundleId or by
 * substring of the pathway name (e.g. "Dysphagia" matches "Dysphagia / Aspiration
 * Risk"). Foundations only surfaces candidates — the engine (#2) enforces the real
 * activation criteria + order requirement before adding a task.
 */
export function pathwaysForConditions(active: string[]): ConditionPathway[] {
  const needles = active.map((a) => a.trim().toLowerCase()).filter(Boolean);
  return ALL_CONDITION_PATHWAYS.filter((p) => {
    const id = p.bundleId.toLowerCase();
    const name = p.pathway.toLowerCase();
    return needles.some((n) => n === id || name.includes(n) || n.includes(name));
  });
}

/** The 4 Memory / Cognitive-Behavioral pathways — cross-LOC, never implied by LOC 4. */
export function memoryPathways(): ConditionPathway[] {
  return ALL_CONDITION_PATHWAYS.filter((p) => p.memoryPathway);
}

/** AS Care Delivery Map entry for a domain at a given score (0-4). */
export function careDeliveryMap(domainCode: string, score: number): CareDeliveryEntry | undefined {
  return CARE_DELIVERY_MAP.find((e) => e.domainCode === domainCode && e.asLevel === score);
}
