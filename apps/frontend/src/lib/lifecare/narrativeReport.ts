// Pre-Admission Resident Assessment Report — a formal, prose narrative report
// modelled on LifeCare Living's own report template. Built deterministically from a
// validated v4.2 assessment: identity + acuity, a plain-language clinical summary,
// a functional assessment (area by area, using the assessor's own evidence notes),
// strengths, care priorities, an acuity classification table, and the recommended
// level of care. Rendered as a printable page the user saves as PDF via the browser
// Print dialog (same approach as the SBAR export).

import type { AssessmentV42, DomainEntry } from "./assessment.ts";
import { originOf } from "./assessment.ts";
import { ASSESSMENT_DOMAINS } from "./dataset.ts";
import { lifecareLetterhead, LIFECARE_BRAND_CSS } from "./brand.ts";

const LEVEL_NAME: Record<string, string> = {
  L1: "Level 1 – Minimal Care Support",
  L2: "Level 2 – Moderate Care Support",
  L3: "Level 3 – Substantial Care Support",
  L4: "Level 4 – High / Comprehensive Care",
  L5: "Level 5 – Comfort / End-of-Life Care",
};

const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const has = (v: unknown): boolean => v != null && String(v).trim() !== "" && !(Array.isArray(v) && v.length === 0);
const val = (v: unknown): string => (Array.isArray(v) ? v.filter(Boolean).join(", ") : String(v ?? "")).trim();

const DOMAIN = Object.fromEntries(ASSESSMENT_DOMAINS.map((d) => [d.code, d]));
const scoreOf = (a: AssessmentV42, code: string): number => Math.max(0, Math.min(4, Number(a.domains?.[code as keyof typeof a.domains]?.score) || 0));
const entryOf = (a: AssessmentV42, code: string): DomainEntry | undefined => a.domains?.[code as keyof typeof a.domains];
const anchorOf = (code: string, score: number): string => DOMAIN[code]?.anchors?.[score] || "";

function ageFrom(dob?: string, given?: string): string {
  if (has(given)) return String(given).trim();
  if (!dob) return "";
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 130 ? String(age) : "";
}

// Pronoun / honorific helpers keep the prose grammatical without guessing marital status.
function persona(sex?: string, lastName?: string, fullName?: string) {
  const x = String(sex ?? "").trim().toUpperCase();
  const female = x === "F" || x === "FEMALE";
  const male = x === "M" || x === "MALE";
  const honorific = female ? "Ms." : male ? "Mr." : "";
  const subject = female ? "she" : male ? "he" : "they";
  const poss = female ? "her" : male ? "his" : "their";
  const isPlural = !female && !male; // "they" takes plural verb agreement
  const nameRef = honorific && lastName ? `${honorific} ${lastName}` : (fullName || "The resident");
  return { honorific, subject, poss, isPlural, nameRef, female, male };
}

const para = (t: string): string => (t.trim() ? `<p>${t.trim()}</p>` : "");
const bullets = (items: string[]): string => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "");

/** A functional-assessment subsection: heading + the assessor's evidence, or the plain anchor. */
function funcArea(a: AssessmentV42, title: string, codes: string[]): string {
  const parts = codes.map((code) => {
    const e = entryOf(a, code);
    if (!e) return "";
    const anchor = anchorOf(code, scoreOf(a, code));
    const ev = e.evidence?.trim();
    // Lead with the assessor's own evidence note; fall back to the plain anchor description.
    const body = ev ? `${anchor ? `${esc(anchor)}. ` : ""}${esc(ev)}` : esc(anchor);
    return body.trim();
  }).filter(Boolean);
  if (!parts.length) return "";
  // Wrap the subsection so its heading + paragraphs stay together across a page break.
  return `<div class="block"><h3>${esc(title)}</h3>${parts.map((p) => `<p>${p}</p>`).join("")}</div>`;
}

/** Build the full report HTML for a validated assessment. */
export function buildNarrativeHtml(a: AssessmentV42): string {
  const l1 = a.layer1 || ({} as AssessmentV42["layer1"]);
  const l3 = a.layer3 || ({} as AssessmentV42["layer3"]);
  const name = l1.residentName?.trim() || [l1.firstName, l1.lastName].filter(Boolean).join(" ").trim() || "Resident";
  const p = persona(l1.sex, l1.lastName, name);
  const age = ageFrom(l1.dateOfBirth, l1.age);
  const rawScore = ASSESSMENT_DOMAINS.filter((d) => d.scored).reduce((sum, d) => sum + scoreOf(a, d.code), 0);
  const levelName = l3.finalLevel ? (LEVEL_NAME[l3.finalLevel] || l3.finalLevel) : "To be confirmed";
  const V = (sg: string, pl: string) => (p.isPlural ? pl : sg); // verb agreement helper
  // A reassessment carries a prior assessment forward, or was raised from the Care
  // Acuity / LOC Decision Review board (origin ACUITY) for an already-admitted resident.
  const isReassessment = has(l3.priorAssessmentId) || originOf(a) === "ACUITY";
  const reportTitle = isReassessment ? "Resident Reassessment Report" : "Pre-Admission Resident Assessment Report";
  const assessmentKind = isReassessment ? "Reassessment" : "Pre-Admission Assessment";

  // ── Identity block ──────────────────────────────────────────────────────────
  const idRows = [
    ["Resident", name],
    ["Age", age ? `${age} years old` : ""],
    ["Assessment Type", assessmentKind],
    ["Assessment Date", l1.assessmentDate],
    ["Assessment Conducted By", [l1.assessor, l1.assessorRole].filter(Boolean).join(" / ")],
    ["Recommended Level of Care", levelName],
    ["LifeCare Acuity Score", `${rawScore} / 56`],
  ].filter(([, v]) => has(v)).map(([l, v]) => `<div class="idrow"><span class="idl">${esc(l as string)}:</span> <span class="idv">${esc(v as string)}</span></div>`).join("");

  // ── Purpose ─────────────────────────────────────────────────────────────────
  const purpose = para(isReassessment
    ? `A comprehensive reassessment was conducted to re-evaluate ${esc(p.nameRef)}'s current health status, functional abilities, mobility, cognitive function, and overall care requirements. The objective is to confirm the most appropriate level of care that continues to promote ${esc(p.poss)} safety, independence, and quality of life within the LifeCare Living community.`
    : `A comprehensive pre-admission assessment was conducted to evaluate ${esc(p.nameRef)}'s current health status, functional abilities, mobility, cognitive function, and overall care requirements. The objective is to recommend the most appropriate level of care that promotes ${esc(p.poss)} safety, independence, and quality of life within the LifeCare Living community.`);

  // ── Clinical summary (templated from captured data) ─────────────────────────
  const sexWord = p.female ? "female" : p.male ? "male" : "resident";
  const histBits: string[] = [];
  if (has(l1.reasonForAdmission)) histBits.push(`a recent history related to ${esc(val(l1.reasonForAdmission))}`);
  else if (l1.hospitalEd12mo && has(l1.hospitalEdReason)) histBits.push(`a recent history of ${esc(val(l1.hospitalEdReason))}`);
  let summary = `${esc(name)} is a ${age ? `${esc(age)}-year-old ` : ""}${esc(sexWord)}${histBits.length ? ` with ${histBits.join(" and ")}` : ""}.`;
  if (has(l1.diagnoses)) summary += ` ${p.female ? "Her" : p.male ? "His" : "Their"} medical history includes ${esc(val(l1.diagnoses))}.`;
  if (has(l1.medications)) summary += ` ${esc(p.subject.charAt(0).toUpperCase() + p.subject.slice(1))} ${V("is", "are")} currently taking prescribed medications, including ${esc(val(l1.medications))}, and continue${V("s", "")} to require routine monitoring to support ${esc(p.poss)} overall health and safety.`;
  const clin2Bits: string[] = [];
  if (scoreOf(a, "AS-10") <= 1) clin2Bits.push("remains continent");
  if (scoreOf(a, "AS-09") <= 1) clin2Bits.push("communicates appropriately");
  if (scoreOf(a, "AS-04") <= 2) clin2Bits.push(`demonstrates ${scoreOf(a, "AS-04") <= 1 ? "no significant" : "only mild"} memory impairment`);
  if (scoreOf(a, "AS-05") <= 1) clin2Bits.push("shows no significant behavioural concerns");
  const clinicalSummary = para(summary) + (clin2Bits.length ? para(`Although ${esc(p.subject)} ${V("requires", "require")} assistance with selected daily activities, ${esc(p.subject)} ${clin2Bits.join(", ")}.`) : "");

  // ── Functional assessment ───────────────────────────────────────────────────
  const functional = [
    funcArea(a, "Mobility", ["AS-02"]),
    funcArea(a, "Activities of Daily Living", ["AS-01"]),
    funcArea(a, "Continence", ["AS-10"]),
    funcArea(a, "Cognitive Function", ["AS-04"]),
    funcArea(a, "Behaviour", ["AS-05"]),
    funcArea(a, "Communication", ["AS-09"]),
    funcArea(a, "Nutrition & Hydration", ["AS-08"]),
    funcArea(a, "Nursing Requirements", ["AS-06", "AS-07"]),
    funcArea(a, "Clinical Risks", ["AS-03", "AS-11", "AS-13"]),
  ].filter(Boolean).join("");

  // ── Strengths (low-score domains → strengths) ───────────────────────────────
  const strengthMap: [string, string][] = [
    ["AS-01", "Independent in many personal care activities"],
    ["AS-10", "Continent of bladder and bowel"],
    ["AS-09", "Able to communicate appropriately"],
    ["AS-05", "Calm and cooperative demeanour"],
    ["AS-04", "Maintains good orientation"],
    ["AS-08", "Regular diet without swallowing difficulties"],
    ["AS-06", "No current need for complex nursing procedures"],
    ["AS-02", "Mobile with minimal assistance"],
  ];
  const strengths = strengthMap.filter(([code]) => entryOf(a, code) && scoreOf(a, code) <= 1).map(([, txt]) => txt);

  // ── Care priorities (higher-score domains + modifier flags) ─────────────────
  const priorityMap: [string, string][] = [
    ["AS-07", "Medication management and adherence"],
    ["AS-03", "Fall prevention and supervised mobility"],
    ["AS-06", "Health monitoring and clinical surveillance"],
    ["AS-04", "Cognitive stimulation and memory support"],
    ["AS-11", "Skin integrity and pressure-injury prevention"],
    ["AS-05", "Behavioural support and de-escalation"],
    ["AS-08", "Nutrition and hydration support"],
    ["AS-02", "Mobility support and safe transfers"],
    ["AS-10", "Continence care and toileting support"],
  ];
  const priorities = priorityMap.filter(([code]) => scoreOf(a, code) >= 2).map(([, txt]) => txt);
  priorities.push("Social engagement and participation in meaningful activities");

  // ── Acuity classification table (all 14 domains grouped; totals to /56) ──────
  const groups: [string, string[]][] = [
    ["Activities of Daily Living", ["AS-01", "AS-08"]],
    ["Mobility", ["AS-02"]],
    ["Continence", ["AS-10"]],
    ["Cognition & Communication", ["AS-04", "AS-05", "AS-09"]],
    ["Nursing Complexity", ["AS-06", "AS-07"]],
    ["Clinical Risks & Safety", ["AS-03", "AS-11", "AS-12", "AS-13", "AS-14"]],
  ];
  const acuityRows = groups.map(([label, codes]) => {
    const sub = codes.reduce((s, c) => s + scoreOf(a, c), 0);
    const max = codes.length * 4;
    return `<tr><td>${esc(label)}</td><td class="sc">${sub} / ${max}</td></tr>`;
  }).join("");
  const acuityTable = `<table class="acuity"><thead><tr><th>Domain</th><th>Score</th></tr></thead><tbody>${acuityRows}<tr class="total"><td>Total Score</td><td class="sc">${rawScore} / 56</td></tr></tbody></table>`;

  // ── Recommendation ──────────────────────────────────────────────────────────
  const locRationale = has(l3.finalLevelJustification)
    ? para(esc(val(l3.finalLevelJustification)))
    : para(`${esc(p.nameRef)}'s assessment indicates ${esc(p.poss)} care needs are best met under ${esc(levelName)}, balancing independence with the right level of supervision and support.`);
  const interval = has(l3.reassessmentInterval) ? val(l3.reassessmentInterval) : "periodically";
  const recommendation =
    para(isReassessment
      ? `Based on the reassessment findings, LifeCare Living recommends ${esc(name)}'s level of care be set to <b>${esc(levelName)}</b>.`
      : `Based on the assessment findings, LifeCare Living recommends admission under <b>${esc(levelName)}</b>.`) +
    para(`This level of care provides an appropriate balance between promoting independence and ensuring safety through personalized assistance, routine nursing oversight, structured daily activities, and a supportive residential environment.`) +
    para(`${esc(name)} is expected to benefit from regular supervision, medication management, and opportunities for social engagement while preserving ${esc(p.poss)} dignity and independence.`) +
    para(`A reassessment will be conducted ${esc(interval)}, or earlier if there is a significant change in ${esc(p.poss)} medical or functional condition, to ensure that ${esc(p.poss)} care plan continues to meet ${esc(p.poss)} evolving needs.`);

  // ── Prepared by / sign-off ──────────────────────────────────────────────────
  const preparedBy = [l1.assessor, "LifeCare Living Solutions, Inc."].filter(Boolean);

  const S = (title: string, inner: string) => (inner.trim() ? `<section><h2>${esc(title)}</h2>${inner}</section>` : "");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(reportTitle)} — ${esc(name)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:"Segoe UI",system-ui,-apple-system,Arial,sans-serif;color:#1f2933;line-height:1.6;max-width:820px;margin:0 auto;padding:44px 48px;font-size:14px}
  ${LIFECARE_BRAND_CSS}
  .rule{border:0;border-top:1.5px solid #ced4da;margin:10px 0 18px}
  .company{font-weight:800;font-size:17px;margin:0 0 2px}
  .title{font-weight:700;font-size:14px;color:#343a40;margin:0 0 12px}
  .idrow{margin:2px 0}.idl{font-weight:700}.idv{color:#343a40}
  section{margin-top:22px}
  h2{font-size:15px;color:#212529;border-bottom:1.5px solid #dee2e6;padding-bottom:5px;margin:0 0 10px;break-after:avoid;page-break-after:avoid}
  h3{font-size:13.5px;color:#1c7ed6;margin:12px 0 3px;break-after:avoid;page-break-after:avoid}
  p{margin:6px 0}
  ul{margin:6px 0;padding-left:22px}li{margin:3px 0}
  table.acuity{width:100%;border-collapse:collapse;margin:6px 0;max-width:460px}
  table.acuity th{text-align:left;font-size:12px;color:#495057;border-bottom:1.5px solid #dee2e6;padding:6px 4px}
  table.acuity td{padding:6px 4px;border-bottom:1px solid #f1f3f5}
  table.acuity td.sc{text-align:right;font-variant-numeric:tabular-nums}
  table.acuity,tr,li,.block{page-break-inside:avoid;break-inside:avoid}
  .block{margin:10px 0}.block h3{margin-top:0}
  table.acuity tr.total td{font-weight:800;border-top:1.5px solid #ced4da;border-bottom:0}
  .lochead{font-weight:800;font-size:15px;color:#2f9e44;margin:10px 0 2px}
  .signoff{font-size:12.5px;color:#495057;background:#f1f3f5;border-radius:8px;padding:8px 12px}
  .prepared{margin-top:26px}.prepared .l{font-weight:800;margin-bottom:4px}
  .foot{margin-top:26px;border-top:1px solid #e9ecef;padding-top:10px;color:#adb5bd;font-size:11px}
  /* @page margin MUST stay 0 — any non-zero margin makes the browser print its
     own header/footer (date, title, about:blank, page number) in that space.
     Per-page top/bottom whitespace comes from the repeating thead/tfoot spacers
     of the wrapping table; horizontal margins from the body cell padding. */
  @page{margin:0}
  table.sheet{width:100%;border-collapse:collapse}
  table.sheet>thead>tr>td,table.sheet>tfoot>tr>td{padding:0;border:0}
  .vpad{height:0}
  @media print{
    body{padding:0;max-width:none;margin:0}
    td.sheet-body{padding:0 44px}
    .vpad{height:34px}
  }
</style></head><body onload="window.focus();window.print()">
  <table class="sheet"><thead><tr><td><div class="vpad"></div></td></tr></thead><tbody><tr><td class="sheet-body">
  ${lifecareLetterhead()}
  <hr class="rule">
  <p class="company">LifeCare Living Solutions, Inc.</p>
  <p class="title">${esc(reportTitle)}</p>
  ${idRows}
  ${S("Purpose of Assessment", purpose)}
  ${S("Clinical Summary", clinicalSummary)}
  ${S("Functional Assessment", functional)}
  ${S("Resident Strengths", bullets(strengths))}
  ${S("Recommended Care Priorities", bullets(priorities))}
  ${S("LifeCare Acuity Classification", `<div class="block">${acuityTable}<p class="lochead">Recommended Level of Care: ${esc(levelName)}</p></div>` + locRationale)}
  ${S("Recommendation", recommendation)}
  <div class="prepared"><div class="l">Prepared by</div>${preparedBy.map((x, i) => `<div${i === 0 ? ' style="font-weight:700"' : ""}>${esc(x)}</div>`).join("")}</div>
  <div class="foot">Model ${esc(a.modelVersion || "v4.2")} · Generated ${esc(new Date().toLocaleString())} · Confidential — for authorized use only.</div>
  </td></tr></tbody><tfoot><tr><td><div class="vpad"></div></td></tr></tfoot></table>
</body></html>`;
}

/** Open the report in a new window and trigger the browser's Print / Save-as-PDF dialog. */
export function printNarrativeReport(a: AssessmentV42): void {
  const w = window.open("", "_blank", "width=840,height=920");
  if (!w) return;
  // The document prints itself from <body onload> once the logo image has
  // loaded — calling print() here would race the image and drop it from the PDF.
  w.document.write(buildNarrativeHtml(a));
  w.document.close();
}
