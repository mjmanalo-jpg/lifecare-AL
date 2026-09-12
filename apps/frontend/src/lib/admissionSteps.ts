// The move-in wizard's shape, shared by the wizard itself and every read model that
// reports progress through it.
//
// The dashboard used to hardcode "step N of 8" while the wizard had already been cut to
// four steps, so a resident on the last step read "step 4 of 8" — half done, when they
// were finished. Keep the count here, not in each caller.

export const ADMISSION_STEP_KEYS = ["registration", "medical", "care", "room"] as const;

export type AdmissionStepKey = (typeof ADMISSION_STEP_KEYS)[number];

export const ADMISSION_STEP_COUNT = ADMISSION_STEP_KEYS.length;

/** "Step 3 of 4", clamped so a stale currentStep from an older wizard never reads past the end. */
export function admissionStepLabel(currentStep: number | null | undefined): string {
  const step = Math.min(Math.max(Number(currentStep) || 1, 1), ADMISSION_STEP_COUNT);
  return `step ${step} of ${ADMISSION_STEP_COUNT}`;
}
