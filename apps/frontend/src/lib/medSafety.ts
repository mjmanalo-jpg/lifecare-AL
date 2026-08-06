/**
 * Medication safety classifier — "automatic identification" of controlled
 * substances, psychotropics, hazardous drugs, and drugs that warrant a vitals
 * check before administration. Name-based (works on existing data with no
 * schema change): each medication name is matched against curated keyword
 * lists common in senior-living care.
 *
 * This is a safety aid, not a substitute for a pharmacist or a full drug
 * database — it errs toward flagging.
 */

// DEA schedule II — highest control (opioids, stimulants).
const SCHEDULE_II = ["oxycodone", "oxycontin", "hydrocodone", "morphine", "fentanyl", "hydromorphone", "dilaudid", "methadone", "oxymorphone", "methylphenidate", "ritalin", "concerta", "amphetamine", "adderall", "lisdexamfetamine", "vyvanse", "tapentadol"];
// Schedule III–V — benzodiazepines, sleep aids, weaker opioids, gabapentinoids.
const SCHEDULE_LOW = ["alprazolam", "xanax", "lorazepam", "ativan", "diazepam", "valium", "clonazepam", "klonopin", "temazepam", "restoril", "zolpidem", "ambien", "eszopiclone", "lunesta", "tramadol", "ultram", "codeine", "phenobarbital", "buprenorphine", "suboxone", "pregabalin", "lyrica", "testosterone", "ketamine", "diazep"];

const PSYCHOTROPIC = ["haloperidol", "haldol", "risperidone", "risperdal", "quetiapine", "seroquel", "olanzapine", "zyprexa", "aripiprazole", "abilify", "ziprasidone", "clozapine", "sertraline", "zoloft", "fluoxetine", "prozac", "citalopram", "celexa", "escitalopram", "lexapro", "paroxetine", "paxil", "venlafaxine", "effexor", "duloxetine", "cymbalta", "mirtazapine", "remeron", "trazodone", "bupropion", "wellbutrin", "lithium", "valproate", "valproic", "depakote", "lamotrigine", "lamictal", "carbamazepine", "tegretol"];

const HAZARDOUS = ["warfarin", "coumadin", "methotrexate", "mycophenolate", "cellcept", "azathioprine", "cyclosporine", "tacrolimus", "hydroxyurea", "finasteride", "estrogen", "estradiol", "cyclophosphamide", "chlorambucil", "tamoxifen", "leuprolide", "spironolactone"];

// Meds where BP/HR/glucose should be checked before giving.
const NEEDS_VITALS = ["lisinopril", "enalapril", "ramipril", "losartan", "valsartan", "amlodipine", "metoprolol", "atenolol", "carvedilol", "bisoprolol", "hydrochlorothiazide", "furosemide", "lasix", "clonidine", "digoxin", "insulin", "metformin", "glipizide", "glimepiride", "glyburide", "warfarin", "oxycodone", "morphine", "fentanyl", "hydromorphone", "hydrocodone"];

const has = (name: string, list: string[]) => { const n = name.toLowerCase(); return list.some((k) => n.includes(k)); };

export interface MedFlags {
  controlled: boolean;
  deaSchedule: "II" | "III-V" | null;
  psychotropic: boolean;
  hazardous: boolean;
  needsVitals: boolean;
}

export function classifyMedication(name: string | undefined | null): MedFlags {
  const n = (name ?? "").trim();
  const sII = has(n, SCHEDULE_II);
  const sLow = has(n, SCHEDULE_LOW);
  return {
    controlled: sII || sLow,
    deaSchedule: sII ? "II" : sLow ? "III-V" : null,
    psychotropic: has(n, PSYCHOTROPIC),
    hazardous: has(n, HAZARDOUS),
    needsVitals: has(n, NEEDS_VITALS),
  };
}

/** Short human labels for the flags a medication carries (for badges). */
export function medFlagLabels(name: string | undefined | null): { label: string; tone: "red" | "purple" | "amber" | "blue" }[] {
  const f = classifyMedication(name);
  const out: { label: string; tone: "red" | "purple" | "amber" | "blue" }[] = [];
  if (f.controlled) out.push({ label: f.deaSchedule === "II" ? "Controlled C-II" : "Controlled", tone: "red" });
  if (f.psychotropic) out.push({ label: "Psychotropic", tone: "purple" });
  if (f.hazardous) out.push({ label: "Hazardous", tone: "amber" });
  if (f.needsVitals) out.push({ label: "Vitals first", tone: "blue" });
  return out;
}

/** Default guardrail for PRN dosing when the order doesn't specify one. */
export const DEFAULT_PRN_MIN_INTERVAL_HOURS = 4;

/** True if the frequency string denotes a PRN (as-needed) medication. */
export function isPrn(frequency: string | undefined | null): boolean {
  return /\bprn\b|as needed/i.test(String(frequency ?? ""));
}

/** Extract an explicit "every N hours" interval from a frequency string, if present. */
export function prnIntervalHours(frequency: string | undefined | null): number {
  const m = String(frequency ?? "").match(/every\s+(\d+)\s*h(?:our|r)?/i);
  return m ? Number(m[1]) : DEFAULT_PRN_MIN_INTERVAL_HOURS;
}
