export interface ReleaseIntervention {
  title?: string | null;
  description?: string | null;
  status?: string | null;
}

export interface ReleaseableCarePlan {
  status?: string | null;
  careGoals?: string | null;
  carePlanItems?: ReleaseIntervention[];
}

export interface CarePlanReleaseInput {
  approvedByName?: string | null;
  effectiveDate?: string | null;
  nextReviewDate?: string | null;
}

const validDate = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Finalized step-9 activation gates for an individualized care-plan draft. */
export function carePlanReleaseIssues(plan: ReleaseableCarePlan, input: CarePlanReleaseInput): string[] {
  const issues: string[] = [];
  if (!new Set(["DRAFT", "UNDER_REVIEW"]).has(String(plan.status || ""))) issues.push("Only a draft or under-review plan can be approved.");
  if (!input.approvedByName?.trim()) issues.push("Nursing approver is required.");

  const effective = validDate(input.effectiveDate);
  const nextReview = validDate(input.nextReviewDate);
  if (!effective) issues.push("A valid effective date is required.");
  if (!nextReview) issues.push("A valid next review date is required.");
  if (effective && nextReview && nextReview.getTime() <= effective.getTime()) issues.push("Next review date must be after the effective date.");
  if (!plan.careGoals?.trim()) issues.push("At least one resident goal is required.");

  const interventions = (plan.carePlanItems ?? []).filter((item) => String(item.status || "ACTIVE") === "ACTIVE");
  if (!interventions.length) issues.push("At least one active intervention is required.");
  for (const item of interventions) {
    const label = item.title?.trim() || "Intervention";
    const description = item.description || "";
    if (!/\[task:[^\]]+\]/i.test(description)) issues.push(`${label}: governed Care Task ID is missing.`);
    if (!/Frequency:\s*[^·[]+/i.test(description)) issues.push(`${label}: individualized frequency/timing is missing.`);
    if (!/Individualized:\s*[^[]+/i.test(description)) issues.push(`${label}: resident-specific assistance, technique/preferences or responsible role is missing.`);
  }
  return issues;
}

