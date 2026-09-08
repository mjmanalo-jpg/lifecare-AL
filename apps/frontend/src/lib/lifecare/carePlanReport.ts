// Resident Care Plan — printable document in LifeCare Living's house format
// (same brand header, per-page margins and print shell as the pre-admission
// narrative report). Built from the assessment-driven care plan: one section per
// scored domain, each with its Goal / Preference and Interventions. Rendered as a
// printable page the user saves as PDF via the browser Print dialog.

import { lifecareLetterhead, LIFECARE_BRAND_CSS } from "./brand";

const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export interface CarePlanReportDomain {
  code: string;
  name: string;
  score: number;
  goal: string;
  evidence?: string;       // Supporting Evidence / Clinical Monitoring captured at assessment
  interventions: string[];
}

export interface CarePlanReportInput {
  residentName: string;
  room?: string;
  level: number;
  levelName: string;
  preparedBy?: string;
  planDate?: string;              // ISO or display; defaults to today
  reviewFrequency?: string;
  domains: CarePlanReportDomain[];
}

/** Build the full care-plan HTML in the LifeCare Living document format. */
export function buildCarePlanHtml(input: CarePlanReportInput): string {
  const dateStr = input.planDate?.trim() || new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const idRows = [
    ["Resident", input.residentName],
    ["Room", input.room],
    ["Level of Care", input.levelName],
    ["Plan Date", dateStr],
    ["Review Frequency", input.reviewFrequency],
  ].filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([l, v]) => `<div class="idrow"><span class="idl">${esc(l as string)}:</span> <span class="idv">${esc(v as string)}</span></div>`)
    .join("");

  const domainSections = input.domains.map((d) => {
    const ivx = d.interventions.map((x) => x.trim()).filter(Boolean);
    const goal = d.goal.trim();
    const evidence = (d.evidence ?? "").trim();
    return `<div class="block domain">
      <h3>${esc(d.code)} · ${esc(d.name)} <span class="score">Score ${esc(d.score)}/4</span></h3>
      ${goal ? `<p class="goal"><span class="lbl">Goal:</span> ${esc(goal)}</p>` : ""}
      ${evidence ? `<p class="goal"><span class="lbl">Supporting Evidence / Clinical Monitoring:</span> ${esc(evidence)}</p>` : ""}
      ${ivx.length ? `<p class="lbl">Interventions:</p><ul>${ivx.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
    </div>`;
  }).join("");

  const preparedBy = [input.preparedBy, "LifeCare Living Solutions, Inc."].filter(Boolean) as string[];

  return `<!doctype html><html><head><meta charset="utf-8"><title>Resident Care Plan — ${esc(input.residentName)}</title>
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
  h3{font-size:13.5px;color:#1c7ed6;margin:12px 0 4px;break-after:avoid;page-break-after:avoid}
  h3 .score{font-size:11px;font-weight:700;color:#868e96}
  p{margin:6px 0}
  .lbl{font-weight:700;color:#343a40}
  .goal{margin:4px 0}
  ul{margin:4px 0 6px;padding-left:22px}li{margin:3px 0}
  .block{margin:12px 0}.block h3{margin-top:0}
  .block,tr,li{page-break-inside:avoid;break-inside:avoid}
  .prepared{margin-top:26px}.prepared .l{font-weight:800;margin-bottom:4px}
  .foot{margin-top:26px;border-top:1px solid #e9ecef;padding-top:10px;color:#adb5bd;font-size:11px}
  /* @page margin MUST stay 0 — any non-zero margin makes the browser print its own
     header/footer. Per-page whitespace comes from the wrapping table thead/tfoot
     spacers; horizontal margins from the body cell padding. */
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
  <p class="title">Resident Care Plan</p>
  ${idRows}
  <section><h2>Individualized Care Plan</h2>${domainSections || "<p>No care domains recorded.</p>"}</section>
  <div class="prepared"><div class="l">Prepared by</div>${preparedBy.map((x, i) => `<div${i === 0 ? ' style="font-weight:700"' : ""}>${esc(x)}</div>`).join("")}</div>
  <div class="foot">Generated ${esc(new Date().toLocaleString())} · Confidential — for authorized use only.</div>
  </td></tr></tbody><tfoot><tr><td><div class="vpad"></div></td></tr></tfoot></table>
</body></html>`;
}

/** Open the care plan in a new window and trigger the browser Print / Save-as-PDF dialog. */
export function printCarePlan(input: CarePlanReportInput): void {
  const w = window.open("", "_blank", "width=840,height=920");
  if (!w) return;
  // The document prints itself from <body onload> once the logo image has
  // loaded — calling print() here would race the image and drop it from the PDF.
  w.document.write(buildCarePlanHtml(input));
  w.document.close();
}
