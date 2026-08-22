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
  const ratio = input.denominator > 0 ? input.numerator / input.denominator : 0;
  const display = format === "COUNT"
    ? String(input.numerator)
    : format === "DURATION"
      ? (input.numerator > 0 ? `${Math.round(input.numerator)}m` : "—")
      : (input.denominator > 0 ? `${Math.round(ratio * 100)}%` : "—");
  return {
    ...input,
    display,
    definitionVersion: input.definitionVersion ?? "1.0",
    threshold: input.threshold ?? (format === "PERCENT" ? "Good = complete; Watch = partial; Action = none completed" : "Informational count"),
    exclusions: input.exclusions ?? [],
    state: input.state ?? (format === "PERCENT" ? (ratio >= 1 ? "GOOD" : ratio > 0 ? "WATCH" : "ACTION") : "GOOD"),
  };
}
