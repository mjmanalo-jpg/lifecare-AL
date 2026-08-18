// Tunable clinical-alert thresholds — the numeric cutoffs that drive care-log and
// weight-monitoring alerts, sourced from the rule-data master
// `clinical_alert_rules.json` instead of being hardcoded inline in each board.
// (Categorical clinical scales like the Bristol stool scale or edema staging are
// fixed medical standards and stay in the boards.)

import rules from "./data/clinical_alert_rules.json" with { type: "json" };

export interface ClinicalAlertRules {
  pain: { severeGte: number; moderateGte: number };
  sleep: { poorHoursLt: number };
  weight: { lossWindowDays: number; consecutiveDrops: number };
}

export const CLINICAL_ALERT_RULES = rules as ClinicalAlertRules;
