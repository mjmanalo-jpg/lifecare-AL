// B1 — Rule-data as versioned JSON (migration-free, tunable without a redeploy).
// The canonical model ships as JSON in ./data/*. At runtime any table can be
// overridden from an app-settings row keyed `lifecare_<table>` (same tenant-scoped
// JSON pattern used across the app), so LifeCare can tune rules post-calibration
// without a deploy. When no override exists the bundled defaults apply.

import mlrRules from "./data/mlr_rules.json" with { type: "json" };
import clinicalModifiers from "./data/clinical_modifiers.json" with { type: "json" };
import assessmentDomains from "./data/assessment_domains.json" with { type: "json" };
import careLevelModel from "./data/care_level_model.json" with { type: "json" };
import pcgRules from "./data/pcg_rules.json" with { type: "json" };
import acsRules from "./data/acs_rules.json" with { type: "json" };
import decisionTrees from "./data/decision_trees.json" with { type: "json" };
import careTaskMaster from "./data/care_task_master.json" with { type: "json" };
import careEventMaster from "./data/care_event_master.json" with { type: "json" };
import locValidationCases from "./data/loc_validation_cases.json" with { type: "json" };
import scenarioTests from "./data/scenario_tests.json" with { type: "json" };
import assessmentToCarePlan from "./data/assessment_to_care_plan.json" with { type: "json" };
import modelVersion from "./data/model_version.json" with { type: "json" };

import type {
  MlrRule, ClinicalModifier, DomainDef, PcgRule, AcsRule,
  DecisionTree, CareTask, CareEvent,
} from "./types.ts";

export const MODEL_VERSION = modelVersion;
export const MLR_RULES = mlrRules as MlrRule[];
export const CLINICAL_MODIFIERS = clinicalModifiers as ClinicalModifier[];
export const ASSESSMENT_DOMAINS = assessmentDomains as DomainDef[];
export const SCORED_DOMAINS = ASSESSMENT_DOMAINS.filter((d) => d.scored);
export const CARE_LEVEL_MODEL = careLevelModel as {
  levels: Array<Record<string, string>>;
  baselineByDomain: Array<Record<string, string>>;
};
export const PCG_RULES = pcgRules as PcgRule[];
export const ACS_RULES = acsRules as AcsRule[];
export const DECISION_TREES = decisionTrees as DecisionTree[];
export const CARE_TASK_MASTER = careTaskMaster as CareTask[];
export const CARE_EVENT_MASTER = careEventMaster as CareEvent[];
export const LOC_VALIDATION_CASES = locValidationCases as Array<Record<string, unknown>>;
export const SCENARIO_TESTS = scenarioTests as {
  scenarios: Array<Record<string, string>>;
  gaps: Array<Record<string, string>>;
};
export const ASSESSMENT_TO_CARE_PLAN = assessmentToCarePlan as {
  steps: Array<Record<string, string>>;
  gates: Array<Record<string, string>>;
};

/** app-settings key for a runtime override of a rule table. */
export function ruleTableSettingKey(table: string): string {
  return `lifecare_${table}`;
}

/** Lookup helpers. */
export const taskById = (id: string): CareTask | undefined =>
  CARE_TASK_MASTER.find((t) => t.id === id);
export const eventById = (id: string): CareEvent | undefined =>
  CARE_EVENT_MASTER.find((e) => e.id === id);
export const modifierById = (id: string): ClinicalModifier | undefined =>
  CLINICAL_MODIFIERS.find((m) => m.id === id);
export const mlrById = (id: string): MlrRule | undefined =>
  MLR_RULES.find((r) => r.id === id);
export const decisionTreeById = (id: string): DecisionTree | undefined =>
  DECISION_TREES.find((d) => d.id === id);

/**
 * Merge a bundled default table with an optional app-settings override array.
 * Override rows replace defaults by `id`; new ids are appended. Pass the parsed
 * JSON value of the `lifecare_<table>` app-setting (or null) as `override`.
 */
export function mergeRuleTable<T extends { id: string }>(
  defaults: T[],
  override: unknown,
): T[] {
  if (!Array.isArray(override)) return defaults;
  const byId = new Map<string, T>(defaults.map((d) => [d.id, d]));
  for (const row of override as T[]) {
    if (row && typeof row.id === "string") byId.set(row.id, { ...byId.get(row.id), ...row });
  }
  return Array.from(byId.values());
}
