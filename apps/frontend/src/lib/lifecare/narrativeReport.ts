// Plain-language ("layman's terms") narrative report for a validated v4.2 assessment.
// Renders EVERYTHING the assessor captured — profile, clinical history, personal
// goals, each of the 14 care-need domains (score → plain description + notes),
// the final level of care, and the clinical sign-off — as a printable document the
// user saves as a PDF via the browser's Print dialog (same approach as SBAR export).

import type { AssessmentV42 } from "./assessment.ts";
import { ASSESSMENT_DOMAINS } from "./dataset.ts";

const LEVEL_NAME: Record<string, string> = {
  L1: "Level 1 — Minimal support (mostly independent)",
  L2: "Level 2 — Low support (some regular help)",
  L3: "Level 3 — Moderate support (help through the day)",
  L4: "Level 4 — High / comprehensive support",
  L5: "Level 5 — Comfort / end-of-life pathway",
};
// Score 0–4 → plain-language amount of help.
const HELP_LABEL = [
  "Independent — no help needed",
  "Occasional / minimal help",
  "Regular help",
  "Extensive help",
  "Full / total help",
];

const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const has = (v: unknown): boolean => v != null && String(v).trim() !== "" && !(Array.isArray(v) && v.length === 0);
const val = (v: unknown): string => (Array.isArray(v) ? v.filter(Boolean).join(", ") : String(v ?? "")).trim();
const yesNo = (v: unknown): string => (v === true ? "Yes" : v === false ? "No" : val(v));

/** One "Label: value" row, omitted when the value is empty. */
const row = (label: string, value: unknown): string =>
  has(value) ? `<div class="row"><span class="l">${esc(label)}</span><span class="v">${esc(val(value))}</span></div>` : "";

const section = (title: string, inner: string): string =>
  inner.trim() ? `<section><h2>${esc(title)}</h2>${inner}</section>` : "";

/** Build the full report HTML for an assessment. */
export function buildNarrativeHtml(a: AssessmentV42): string {
  const l1 = a.layer1 || ({} as AssessmentV42["layer1"]);
  const l3 = a.layer3 || ({} as AssessmentV42["layer3"]);
  const name = l1.residentName?.trim() || "Resident";

  const profile = [
    row("Date of birth", l1.dateOfBirth),
    row("Age", l1.age),
    row("Sex", l1.sex),
    row("Assessment date", l1.assessmentDate),
    row("Assessment location", l1.assessmentLocation || l1.location),
    row("Primary contact / relationship", [l1.primaryContact, l1.primaryContactRelationship].filter(Boolean).join(" — ")),
    row("Contact number", l1.contactNo),
    row("Referral source", l1.referralSource),
    row("Assessed by", [l1.assessor, l1.assessorRole].filter(Boolean).join(" · ")),
    row("Current living arrangement", l1.currentLivingArrangement),
    row("Primary caregiver", l1.primaryCaregiver),
    row("Reason for admission / referral", l1.reasonForAdmission),
    row("Target move-in / admission date", l1.admissionTargetDate),
  ].join("");

  const history = [
    row("Diagnoses / conditions", l1.diagnoses),
    row("Surgeries / significant history", l1.surgeries),
    row("Allergies", l1.allergies),
    row("Current medications", l1.medications),
    row("Medication list reviewed", l1.medicationListReviewed),
    row("Hospital / ER visit in last 12 months", yesNo(l1.hospitalEd12mo)),
    row("Hospital / ER reason", l1.hospitalEdReason),
    row("Significant change in condition (30–90 days)", yesNo(l1.significantChange3090)),
    row("Change described", l1.significantChangeDescribe),
    row("Physician follow-up", l1.physicianFollowUp),
    row("Other hospitalizations", l1.hospitalizations),
  ].join("");

  const goals = [
    row("Able to take part in own care", l1.canParticipate),
    row("Authorized representative", l1.authorizedRepresentative),
    row("Family involvement", [val(l1.familyInvolvement), l1.familyInvolvementOther].filter(Boolean).join("; ")),
    row("Advance directive", l1.advanceDirective),
    row("Cultural / spiritual / privacy preferences", l1.culturalPreferences),
    row("Overall goals", [val(l1.overallGoals), l1.overallGoalsOther].filter(Boolean).join("; ")),
    row("Goals & preferences", l1.goalsPreferences),
    row("Advance care context", l1.advanceCareContext),
  ].join("");

  // 14 scored care-need domains, in AS order, only those the assessor scored.
  const domainCards = ASSESSMENT_DOMAINS
    .filter((d) => d.scored)
    .map((d) => {
      const entry = a.domains?.[d.code as keyof typeof a.domains];
      if (!entry) return "";
      const score = Math.max(0, Math.min(4, Number(entry.score) || 0));
      const anchor = d.anchors?.[score] || "";
      const extra = [
        entry.goalNote ? `<div class="row"><span class="l">Goal / notes</span><span class="v">${esc(entry.goalNote)}</span></div>` : "",
        entry.evidence ? `<div class="row"><span class="l">Evidence</span><span class="v">${esc(entry.evidence)}</span></div>` : "",
        has(entry.modifierFlags) ? `<div class="row"><span class="l">Flags</span><span class="v">${esc(val(entry.modifierFlags))}</span></div>` : "",
      ].join("");
      return `<div class="domain">
        <div class="dhead"><span class="dname">${esc(d.name)}</span><span class="dscore">${esc(HELP_LABEL[score])}</span></div>
        ${anchor ? `<div class="danchor">${esc(anchor)}</div>` : ""}
        ${extra}
      </div>`;
    })
    .join("");

  const outcome = [
    row("Final level of care", l3.finalLevel ? (LEVEL_NAME[l3.finalLevel] || l3.finalLevel) : ""),
    row("Why this level", l3.finalLevelJustification),
    row("Reason for going below the recommended minimum", l3.belowFloorReason),
    row("Applied care modifiers", l3.reconciledModifiers),
    row("Capability review", l3.capabilityReview ? `${l3.capabilityReview.outcome.replace(/_/g, " ")}${l3.capabilityReview.rationale ? ` — ${l3.capabilityReview.rationale}` : ""}` : ""),
    row("Reassessment interval", l3.reassessmentInterval),
    row("Next review date", l3.nextReviewDate),
  ].join("");

  const v = a.validation;
  const signoff = v
    ? [
        row("Decision", v.decision.replace(/_/g, " ")),
        row("Signed off by", [v.by, v.role].filter(Boolean).join(" · ")),
        row("Date", v.at ? v.at.slice(0, 10) : ""),
        row("Notes", v.notes),
      ].join("")
    : "";

  const rawScore = Object.values(a.domains || {}).reduce((sum, e) => sum + (Number((e as { score?: number })?.score) || 0), 0);

  return `<!doctype html><html><head><meta charset="utf-8"><title>Care Assessment Summary — ${esc(name)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f2937;line-height:1.55;max-width:820px;margin:0 auto;padding:40px 44px}
  h1{font-size:22px;margin:0 0 2px}
  .sub{color:#6b7280;font-size:13px;margin-bottom:6px}
  .intro{background:#f5f6f8;border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;font-size:13px;color:#374151;margin:14px 0 8px}
  section{margin-top:22px;page-break-inside:avoid}
  h2{font-size:15px;color:#4338ca;border-bottom:2px solid #e5e7eb;padding-bottom:5px;margin:0 0 10px}
  .row{display:flex;gap:10px;margin:5px 0;font-size:13.5px}
  .l{flex:0 0 210px;font-weight:600;color:#4b5563}
  .v{flex:1;white-space:pre-wrap}
  .domain{border:1px solid #e5e7eb;border-radius:9px;padding:10px 12px;margin:8px 0;page-break-inside:avoid}
  .dhead{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
  .dname{font-weight:700;font-size:14px}
  .dscore{font-size:12px;font-weight:700;color:#4338ca;background:#eef2ff;border-radius:999px;padding:2px 10px;white-space:nowrap}
  .danchor{font-size:13px;color:#374151;margin-top:3px}
  .foot{margin-top:28px;border-top:1px solid #e5e7eb;padding-top:10px;color:#9ca3af;font-size:11.5px}
  @media print{body{padding:0}}
</style></head><body>
  <h1>Care Assessment Summary</h1>
  <div class="sub"><b>${esc(name)}</b>${l1.assessmentDate ? ` · assessed ${esc(l1.assessmentDate)}` : ""}${l1.assessor ? ` · by ${esc(l1.assessor)}` : ""}</div>
  <div class="intro">This is a plain-language summary of ${esc(name)}'s care assessment. It explains, in everyday terms, the support they need day to day and the agreed level of care.</div>
  ${section("About the resident", profile)}
  ${section("Health background", history)}
  ${section("Preferences & goals", goals)}
  ${section("Support needed, area by area", domainCards)}
  ${section("Agreed level of care", outcome)}
  ${section("Clinical sign-off", signoff)}
  <div class="foot">Total care-need score: ${rawScore} of 56 · Model ${esc(a.modelVersion || "v4.2")} · Generated ${esc(new Date().toLocaleString())}</div>
</body></html>`;
}

/** Open the report in a new window and trigger the browser's Print / Save-as-PDF dialog. */
export function printNarrativeReport(a: AssessmentV42): void {
  const w = window.open("", "_blank", "width=840,height=920");
  if (!w) return;
  w.document.write(buildNarrativeHtml(a));
  w.document.close();
  w.focus();
  w.print();
}
