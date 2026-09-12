import type { DashboardMetric, MetricState } from "./types";

export interface MetricInput {
  key: string;
  label: string;
  numerator: number;
  denominator: number;
  numeratorLabel: string;
  denominatorLabel: string;
  definition: string;
  definitionVersion?: string;
  threshold?: string;
  window: string;
  exclusions?: string[];
  sourceModels: string[];
  href: string;
  format?: "PERCENT" | "COUNT" | "DURATION";
  baseline?: string;
  state?: MetricState;
}

export function metric(input: MetricInput): DashboardMetric {
  const format = input.format ?? "PERCENT";
  // Nothing owed yet is not a failure. A 0/0 ratio has no measurement behind it, so it
  // stays out of the attention band and shows "—" — an unmeasured shift must never be
  // reported as "none completed", which put red ACT NOW cards on an idle board.
  const measured = input.denominator > 0;
  const ratio = measured ? input.numerator / input.denominator : 0;
  const display = format === "COUNT"
    ? String(input.numerator)
    : format === "DURATION"
      ? (input.numerator > 0 ? `${Math.round(input.numerator)}m` : "—")
      : (measured ? `${Math.round(ratio * 100)}%` : "—");
  return {
    ...input,
    display,
    definitionVersion: input.definitionVersion ?? "1.0",
    threshold: input.threshold ?? (format === "PERCENT" ? "Good = complete; Watch = partial; Action = none completed" : "Informational count"),
    exclusions: input.exclusions ?? [],
    state: input.state
      ?? (format === "PERCENT" && measured ? (ratio >= 1 ? "GOOD" : ratio > 0 ? "WATCH" : "ACTION") : "GOOD"),
  };
}
