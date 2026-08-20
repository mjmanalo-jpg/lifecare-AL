/**
 * Staff roster — the fortnightly staffing schedule the facility maintains (the
 * client's Excel grid: staff rows × date columns, each cell a coded shift/
 * assignment). This layer PARSES that grid and its shift codes; Phase 2 bridges
 * it into caregiver_schedules / assigneeForResidentToday + the DT-013 private-
 * caregiver assignments. Migration-free: stored as an app-setting JSON.
 *
 * Code grammar (from the client's roster):
 *   [type][assignment][shift][±12]
 *     type       CG (shared) · PCG (private, 1:1) · NOD (nurse on duty) · MID(FLX)
 *     assignment CG<station#>  |  PCG<resident code>
 *     shift      A = AM · P = PM · N = Night · MID = mid/flex
 *     12         12-hour shift (else 8h)
 *   Non-working: RD = rest day · VL = vacation leave · x = off / unfilled
 *
 * Roles collapse to the three system roles (Care Manager / Nurse / Caregiver);
 * Care Coordinator and Lead Caregiver are DESIGNATIONS within them.
 */

export const STAFF_ROSTER_KEY = "staff_roster";

export type RosterBaseRole = "CARE_MANAGER" | "NURSE" | "CAREGIVER";
export type CodeShift = "AM" | "PM" | "NIGHT" | "MID";
export type CodeKind = "WORK" | "REST" | "LEAVE" | "OFF" | "UNKNOWN";
export type CodeType = "CM" | "CC" | "NOD" | "LCG" | "CG" | "PCG";

export interface ParsedCode {
  raw: string;
  kind: CodeKind;
  type?: CodeType;
  shift?: CodeShift;
  hours?: 8 | 12;
  /** resident code for a PCG (private) assignment, e.g. "107". */
  residentCode?: string;
  /** station / team number for a shared CG assignment. */
  station?: string;
  /** true for a private 1:1 (PCG) assignment → ties to DT-013. */
  private?: boolean;
  /** human-readable summary for the cell tooltip / legend. */
  label: string;
}

const SHIFT_OF: Record<string, CodeShift> = { A: "AM", P: "PM", N: "NIGHT" };
const shiftHrs = (s: CodeShift, h?: 8 | 12) => `${s}${h === 12 ? " 12h" : ""}`;

/** Parse a single roster cell code into its parts. Never throws. */
export function parseShiftCode(input: string): ParsedCode {
  const raw = (input ?? "").trim();
  const u = raw.toUpperCase();
  if (!u || u === "-") return { raw, kind: "OFF", label: "—" };
  if (u === "RD") return { raw, kind: "REST", label: "Rest day" };
  if (u === "VL") return { raw, kind: "LEAVE", label: "Vacation leave" };
  if (u === "X") return { raw, kind: "OFF", label: "Off / unfilled" };
  if (u === "MIDFLX") return { raw, kind: "WORK", type: "CM", shift: "MID", label: "Mid shift (flexible)" };
  if (u === "MID") return { raw, kind: "WORK", type: "CC", shift: "MID", label: "Mid shift" };

  let m = /^NOD-?([APN])(12)?$/.exec(u);
  if (m) return { raw, kind: "WORK", type: "NOD", shift: SHIFT_OF[m[1]], hours: m[2] ? 12 : 8, label: `Nurse on duty · ${shiftHrs(SHIFT_OF[m[1]], m[2] ? 12 : 8)}` };

  m = /^PCG(\d+)([APN])(12)?$/.exec(u);
  if (m) return { raw, kind: "WORK", type: "PCG", private: true, residentCode: m[1], shift: SHIFT_OF[m[2]], hours: m[3] ? 12 : 8, label: `Private caregiver · resident ${m[1]} · ${shiftHrs(SHIFT_OF[m[2]], m[3] ? 12 : 8)}` };

  m = /^CG(\d+)([APN])(12)?$/.exec(u);
  if (m) return { raw, kind: "WORK", type: "CG", station: m[1], shift: SHIFT_OF[m[2]], hours: m[3] ? 12 : 8, label: `Caregiver · station ${m[1]} · ${shiftHrs(SHIFT_OF[m[2]], m[3] ? 12 : 8)}` };

  return { raw, kind: "UNKNOWN", label: raw };
}

/** Map an employee code (+ optional section header) to a base role + designation. */
export function roleForEmployee(employeeCode: string, section = ""): { baseRole: RosterBaseRole; designation: string } {
  const c = (employeeCode ?? "").toUpperCase();
  const sec = section.toUpperCase();
  if (/^CM/.test(c)) return { baseRole: "CARE_MANAGER", designation: "Care Manager" };
  if (/^CC/.test(c)) return { baseRole: "CARE_MANAGER", designation: "Care Coordinator" };
  if (/^NOD/.test(c) || sec.includes("NURSE")) return { baseRole: "NURSE", designation: "Nurse" };
  if (/^LCG/.test(c) || sec.includes("LEAD")) return { baseRole: "CAREGIVER", designation: "Lead Caregiver" };
  if (/^CG/.test(c) || sec.includes("CAREGIVER")) return { baseRole: "CAREGIVER", designation: "Caregiver" };
  return { baseRole: "CAREGIVER", designation: "Caregiver" };
}

export interface RosterRow {
  employeeCode: string;
  name: string;
  status: string; // REG / PROBY / OC / FT …
  baseRole: RosterBaseRole;
  designation: string;
  /** dateISO → raw cell code. */
  cells: Record<string, string>;
}

export interface StaffRoster {
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;   // YYYY-MM-DD
  dates: string[];     // ISO date per column, in order
  rows: RosterRow[];
  importedAt?: string;
  note?: string;
}

/** Add `days` calendar days to an ISO date (UTC-safe, no TZ drift). */
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const STATUS_RE = /^(REG|PROBY|OC|FT|PT|RES|AWOL)$/i;
const EMPCODE_RE = /^(CM|CC|NOD|LCG|CG)\d+$/i;
const SECTION_RE = /^(NURSES?|LEAD\s*CAREGIVERS?|CAREGIVERS?|CARE\s*MANAGERS?|STAFF)$/i;

/**
 * Parse a pasted roster grid (TSV/CSV from Excel) into a StaffRoster.
 *
 * Robust to the client's layout: a header row of day-of-month numbers defines
 * the date columns (mapped from `periodStartISO`); leading columns (head count /
 * code / name / status) are detected by content, not fixed position; rows that
 * are just a section title (NURSES, CAREGIVERS…) set the role for the rows below.
 */
export function parseRosterGrid(text: string, opts: { periodStartISO: string }): StaffRoster {
  // Excel paste is TAB-delimited; names contain commas, so only fall back to
  // comma-splitting (quote-aware) when the text has no tabs at all.
  const src = String(text ?? "");
  const useTab = src.includes("\t");
  const splitLine = (line: string): string[] =>
    (useTab ? line.split("\t") : (line.match(/("([^"]*)"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, "")))
      .map((c) => c.replace(/^"|"$/g, "").trim());
  const rows = src.split(/\r?\n/).map(splitLine);

  // 1) Find the header row: the one with the most ascending day-of-month integers.
  let headerIdx = -1, dateCols: number[] = [];
  rows.forEach((cells, i) => {
    const cols: number[] = [];
    cells.forEach((c, j) => { const n = Number(c); if (Number.isInteger(n) && n >= 1 && n <= 31) cols.push(j); });
    if (cols.length > dateCols.length) { dateCols = cols; headerIdx = i; }
  });
  if (headerIdx < 0 || !dateCols.length) {
    return { periodStart: opts.periodStartISO, periodEnd: opts.periodStartISO, dates: [], rows: [] };
  }

  // 2) Column index → ISO date, sequential from the period start.
  const firstDateCol = dateCols[0];
  const dates = dateCols.map((_, k) => addDaysISO(opts.periodStartISO, k));

  // 3) Data rows.
  const out: RosterRow[] = [];
  let section = "";
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i];
    const lead = cells.slice(0, firstDateCol);
    const joined = cells.join(" ").trim();
    if (!joined) continue;

    // A "real" code = a cell that parses as work / rest / leave (weekday labels
    // like TUE parse as UNKNOWN, so a stray weekday header row is not staff data).
    const hasRealCode = dateCols.some((j) => {
      const k = parseShiftCode(cells[j] ?? "").kind;
      return k === "WORK" || k === "REST" || k === "LEAVE";
    });

    // Section header (a role title on its own row)?
    const titleCell = cells.find((c) => SECTION_RE.test(c));
    if (titleCell && !hasRealCode && !lead.some((c) => EMPCODE_RE.test(c))) { section = titleCell; continue; }

    const employeeCode = lead.find((c) => EMPCODE_RE.test(c)) ?? "";
    if (!employeeCode && !hasRealCode) continue; // skip blank / weekday / spacer rows
    const status = lead.find((c) => STATUS_RE.test(c)) ?? "";
    // Name = the longest leading cell that isn't the code/status/head-count number.
    const name = lead
      .filter((c) => c && c !== employeeCode && c !== status && !/^\d+$/.test(c))
      .sort((a, b) => b.length - a.length)[0] ?? "";
    const { baseRole, designation } = roleForEmployee(employeeCode, section);

    const cellMap: Record<string, string> = {};
    dateCols.forEach((j, k) => { const v = (cells[j] ?? "").trim(); if (v) cellMap[dates[k]] = v; });

    out.push({ employeeCode, name, status, baseRole, designation, cells: cellMap });
  }

  return {
    periodStart: opts.periodStartISO,
    periodEnd: dates[dates.length - 1] ?? opts.periodStartISO,
    dates,
    rows: out,
  };
}

export function parseRoster(raw: string | null | undefined): StaffRoster | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v && Array.isArray(v.rows) && Array.isArray(v.dates)) return v as StaffRoster;
  } catch { /* ignore */ }
  return null;
}

/** All working assignments on a given ISO date (for the day view / Phase-2 bridge). */
export function assignmentsOn(roster: StaffRoster, dateISO: string): Array<{ row: RosterRow; code: ParsedCode }> {
  return roster.rows
    .map((row) => ({ row, code: parseShiftCode(row.cells[dateISO] ?? "") }))
    .filter((x) => x.code.kind === "WORK");
}
