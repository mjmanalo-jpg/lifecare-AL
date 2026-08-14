"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Pill, ClipboardList, ConciergeBell, ShieldAlert,
  UserRound, CalendarClock, Loader2, FileDown, StickyNote, IdCard,
  Users, Phone, Syringe, Activity, HeartPulse, Gauge, AlertTriangle,
} from "lucide-react";
import { taskNotesOf } from "@/lib/taskNotes";
import { patientCode } from "@/lib/patientId";
import { parseAcuityItems, LOC_LEVEL_META } from "@/lib/locBilling";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const fmt = (v: unknown) => (v ? new Date(s(v)).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
const fmtDate = (v: unknown) => (v ? new Date(s(v)).toLocaleDateString() : "—");
const cap = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);
const age = (dob: unknown) => {
  if (!dob) return null;
  const d = new Date(s(dob)); if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 31_557_600_000);
};

const STATUS_META: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700 border-emerald-200",
  DISCHARGED: "bg-gray-200 text-gray-700 border-gray-300",
  ON_LEAVE: "bg-amber-100 text-amber-700 border-amber-200",
  DECEASED: "bg-red-100 text-red-700 border-red-200",
};

const VAX_STATUS: Record<string, string> = {
  COMPLETED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  SCHEDULED: "bg-blue-100 text-blue-700 border-blue-200",
  OVERDUE: "bg-red-100 text-red-700 border-red-200",
  DECLINED: "bg-gray-200 text-gray-600 border-gray-300",
  EXEMPTED: "bg-amber-100 text-amber-700 border-amber-200",
};
const SEVERITY_META: Record<string, string> = {
  MILD: "bg-gray-100 text-gray-600 border-gray-200",
  MODERATE: "bg-amber-100 text-amber-700 border-amber-200",
  SEVERE: "bg-orange-100 text-orange-700 border-orange-200",
  LIFE_THREATENING: "bg-red-100 text-red-700 border-red-200",
};

// Human labels for the admission 12-domain baseline + the acuity 10-domain scores.
const ADL_DOMAIN_LABEL: Record<string, string> = {
  clinical: "Clinical / Medical", adl: "Activities of Daily Living", cognitive: "Cognition",
  mobility: "Mobility", nutrition: "Nutrition", medication: "Medication", behavioral: "Behavioral",
  psychosocial: "Psychosocial", continence: "Continence", skin: "Skin / Wounds",
  communication: "Communication", emergency: "Emergency / Safety",
};
const ACUITY_DOMAIN_LABEL: Record<string, string> = {
  adl: "ADL", mobility: "Mobility", cognition: "Cognition", behavior: "Behavior", nutrition: "Nutrition",
  elimination: "Elimination", medication: "Medication", medical: "Medical", psychosocial: "Psychosocial", night: "Night Care",
};

type TabKey = "family" | "emergency" | "vaccines" | "adl" | "medical" | "advance" | "acuity";
const TABS: { key: TabKey; label: string; icon: typeof Pill }[] = [
  { key: "family", label: "Family", icon: Users },
  { key: "emergency", label: "Emergency", icon: Phone },
  { key: "vaccines", label: "Vaccines", icon: Syringe },
  { key: "adl", label: "ADL Baseline", icon: Activity },
  { key: "medical", label: "Medical Hx", icon: ClipboardList },
  { key: "advance", label: "Advance Care", icon: HeartPulse },
  { key: "acuity", label: "Care Acuity", icon: Gauge },
];

async function getJson(url: string) {
  try { const r = await fetch(url, { credentials: "include" }); if (!r.ok) return { ok: false, status: r.status, data: null }; const j = await r.json(); return { ok: true, status: 200, data: j?.data ?? null }; }
  catch { return { ok: false, status: 0, data: null }; }
}

type Assessment = { note?: string; domains?: Record<string, { level?: string; notes?: string }> };
function parseAssessment(raw: string): Assessment | null {
  if (!raw) return null;
  try { const v = JSON.parse(raw); return v && typeof v === "object" ? (v as Assessment) : null; } catch { return null; }
}

// Latest acuity record for a resident — an APPROVED one wins; otherwise the most
// recent of any status (so a pending/in-review assessment still shows).
function latestAcuityFor(items: Array<Record<string, unknown>>, residentId: string): Record<string, unknown> | null {
  const mine = items.filter((x) => x && x.residentId === residentId);
  const approved = mine.filter((x) => x.status === "APPROVED");
  const pool = approved.length ? approved : mine;
  return pool.sort((a, b) => s(b.decidedAt || b.createdAt).localeCompare(s(a.decidedAt || a.createdAt)))[0] || null;
}

export default function ResidentCardPage() {
  const params = useParams();
  const id = String(params?.id ?? "");

  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [resident, setResident] = useState<Row | null>(null);
  const [meds, setMeds] = useState<Row[]>([]);
  const [requests, setRequests] = useState<Row[]>([]);
  const [tasks, setTasks] = useState<Row[]>([]);
  const [comms, setComms] = useState<Row[]>([]);
  const [diets, setDiets] = useState<Row[]>([]);
  const [admissions, setAdmissions] = useState<Row[]>([]);
  const [vaccinations, setVaccinations] = useState<Row[]>([]);
  const [allergyRecs, setAllergyRecs] = useState<Row[]>([]);
  const [acuityRows, setAcuityRows] = useState<Row[]>([]);
  const [sponsor, setSponsor] = useState<Row | null>(null);
  const [tab, setTab] = useState<TabKey>("family");
  const [cardUrl, setCardUrl] = useState("");
  const [qrData, setQrData] = useState("");

  useEffect(() => { setCardUrl(window.location.href); }, []);
  useEffect(() => { if (cardUrl) QRCode.toDataURL(cardUrl, { width: 512, margin: 1 }).then(setQrData).catch(() => {}); }, [cardUrl]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const res = await getJson(`/api/db/residents/${id}`);
      if (!alive) return;
      if (res.status === 401) { setDenied(true); setLoading(false); return; }
      const r = res.data as Row | null;
      setResident(r);
      const [m, sr, tk, pc, dt, adm, vax, alg, acu] = await Promise.all([
        getJson(`/api/db/medications?f_residentId=${id}&take=100`),
        getJson(`/api/db/service-requests?f_residentId=${id}&take=100`),
        getJson(`/api/db/tasks?f_residentId=${id}&take=100`),
        getJson(`/api/db/physician-communications?f_residentId=${id}&take=50`),
        getJson(`/api/db/diet-orders?f_residentId=${id}&take=50`),
        getJson(`/api/db/admissions?f_residentId=${id}&take=5`),
        getJson(`/api/db/vaccinations?f_residentId=${id}&take=100`),
        getJson(`/api/db/allergies?f_residentId=${id}&take=100`),
        getJson(`/api/db/app-settings?f_key=acuity_assessments&take=50`),
      ]);
      if (!alive) return;
      setMeds((m.data as Row[]) || []);
      setRequests((sr.data as Row[]) || []);
      setTasks((tk.data as Row[]) || []);
      setComms((pc.data as Row[]) || []);
      setDiets((dt.data as Row[]) || []);
      setAdmissions((adm.data as Row[]) || []);
      setVaccinations((vax.data as Row[]) || []);
      setAllergyRecs((alg.data as Row[]) || []);
      setAcuityRows((acu.data as Row[]) || []);
      const sponsorId = s(r?.sponsorId);
      if (sponsorId) {
        const sp = await getJson(`/api/db/users?f_id=${sponsorId}&take=1`);
        if (alive) setSponsor(((sp.data as Row[]) || [])[0] || null);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [id]);

  const activeMeds = useMemo(() => meds.filter(m => s(m.status) === "ACTIVE" || s(m.status) === "PENDING"), [meds]);
  const recentRequests = useMemo(
    () => [...requests].sort((a, b) => new Date(s(b.createdAt)).getTime() - new Date(s(a.createdAt)).getTime()).slice(0, 6),
    [requests],
  );
  const openTasks = useMemo(
    () => tasks.filter(t => s(t.status) !== "COMPLETED" && s(t.status) !== "CANCELLED")
      .sort((a, b) => new Date(s(a.dueDate)).getTime() - new Date(s(b.dueDate)).getTime()),
    [tasks],
  );

  // Primary physician derived from the latest physician communication; diet from
  // the resident's active diet order (both migration-free).
  const primaryPhysician = useMemo(() => {
    const latest = [...comms].sort((a, b) => new Date(s(b.occurredAt)).getTime() - new Date(s(a.occurredAt)).getTime())[0];
    return s(latest?.physicianName);
  }, [comms]);
  const dietRestriction = useMemo(() => {
    const active = diets.filter(d => d.active !== false)[0];
    if (!active) return "";
    return [s(active.dietType).replace(/_/g, " "), s(active.restrictions)].filter(Boolean).join(" · ");
  }, [diets]);

  // The admission 12-domain clinical assessment doubles as the ADL baseline.
  const baseline = useMemo(() => parseAssessment(s(admissions[0]?.careAssessment)), [admissions]);
  // Latest acuity (Level of Care) assessment from the migration-free app-setting.
  const acuity = useMemo(() => {
    const row = acuityRows.find((x) => s(x.key) === "acuity_assessments") || acuityRows[0];
    return latestAcuityFor(parseAcuityItems(row ? s(row.value) : null), id);
  }, [acuityRows, id]);

  // Resident has no diagnosis/medicalAssessment column, and allergies/medicalHistory
  // may be blank on the resident while the linked Admission holds them — so fall
  // back to the admission for a complete picture.
  const adm0 = useMemo(() => (admissions[0] || {}) as Row, [admissions]);
  const effAllergies = useMemo(() => s(resident?.allergies) || s(adm0.allergies), [resident, adm0]);
  const effHistory = useMemo(() => s(resident?.medicalHistory) || s(adm0.medicalHistory), [resident, adm0]);
  const effAssessment = useMemo(() => s(adm0.medicalAssessment), [adm0]);
  const primaryDiagnosis = useMemo(() => (effHistory.split(/[;·]/)[0] || "").trim(), [effHistory]);
  // Family sponsor: prefer the linked sponsor User, else fall back to the
  // admission's captured sponsor name/email.
  const sponsorName = useMemo(() => ([s(sponsor?.firstName), s(sponsor?.lastName)].filter(Boolean).join(" ") || s(sponsor?.name) || s(adm0.sponsorName)), [sponsor, adm0]);
  const sponsorEmail = useMemo(() => s(sponsor?.email) || s(adm0.sponsorEmail), [sponsor, adm0]);
  const sponsorPhone = useMemo(() => s(sponsor?.phone), [sponsor]);

  const residentSlug = () => (`${s(resident?.firstName)} ${s(resident?.lastName)}`.trim() || "resident").toLowerCase().replace(/\s+/g, "-");

  // The whole care card as a downloadable PDF (shown after the QR is scanned).
  const downloadFullPdf = () => {
    if (!resident) return;
    const name = `${s(resident.firstName)} ${s(resident.lastName)}`.trim() || "Resident";
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const M = 40, MAXW = 480, PH = doc.internal.pageSize.getHeight();
    let y = 50;
    const ensure = (h = 14) => { if (y + h > PH - 40) { doc.addPage(); y = 50; } };
    const heading = (t: string) => { ensure(24); doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(30); doc.text(t, M, y); y += 15; };
    const body = (t: string) => { doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(70); for (const ln of doc.splitTextToSize(t || "—", MAXW)) { ensure(13); doc.text(ln, M, y); y += 13; } y += 6; };

    doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(20).text("Resident Care Card", M, y);
    if (qrData) doc.addImage(qrData, "PNG", 470, 26, 90, 90);
    y += 22;
    doc.setFont("helvetica", "bold").setFontSize(14).text(name, M, y); y += 15;
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(46, 74, 72).text(`Patient ID: ${patientCode(s(resident.id))}`, M, y); y += 15;
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(100).text(`Room ${s(resident.roomNumber) || "—"} · ${s(resident.careLevel) || "—"} · DOB ${fmtDate(resident.dateOfBirth)}${age(resident.dateOfBirth) != null ? ` · ${age(resident.dateOfBirth)} yrs` : ""}`, M, y); y += 24;

    heading("Allergies"); body(effAllergies || "None on record");
    if (effAssessment) { heading("Clinical Assessment"); body(effAssessment); }
    heading("Medical History"); body(effHistory);
    if (resident.surgeries) { heading("Surgeries"); body(s(resident.surgeries)); }
    if (resident.hospitalizations) { heading("Hospitalizations"); body(s(resident.hospitalizations)); }
    heading("Advance Care"); body(`Code status: ${s(resident.codeStatus) || "—"}${resident.dnrStatus ? " · DNR" : ""}`);
    if (resident.advanceDirectives) body(s(resident.advanceDirectives));
    if (acuity) { heading("Care Acuity"); body(`Level ${s(acuity.level)} — ${LOC_LEVEL_META.find((l) => l.level === Number(acuity.level))?.name || s(acuity.levelName)} · score ${s(acuity.total)}/50 · ${s(acuity.status)}`); }
    heading(`Medications (${activeMeds.length})`);
    activeMeds.length ? activeMeds.forEach(m => body(`• ${s(m.name)} ${s(m.dosage)} · ${s(m.frequency)}${m.route ? ` · ${s(m.route)}` : ""}`)) : body("None active");
    heading("Recent Requests");
    recentRequests.length ? recentRequests.forEach(r => body(`• ${s(r.category).replace(/_/g, " ")}${r.subType ? ` — ${s(r.subType)}` : ""}: ${s(r.details)} [${s(r.status)}]`)) : body("None");
    heading("Assignments / To-do");
    openTasks.length ? openTasks.forEach(t => { body(`• ${s(t.title)}${t.dueDate ? ` (due ${fmtDate(t.dueDate)})` : ""}`); taskNotesOf(t as Record<string, unknown>).forEach(n => body(`    - Note: ${n.text} (${n.author})`)); }) : body("Nothing outstanding");
    if (resident.emergencyContact || resident.emergencyContactPhone) { heading("Emergency Contact"); body(`${s(resident.emergencyContact)} ${resident.emergencyContactPhone ? `· ${s(resident.emergencyContactPhone)}` : ""}`); }

    doc.setFontSize(8).setTextColor(150).text(`Generated ${new Date().toLocaleString()} · confidential — authorized care staff only`, M, PH - 24);
    doc.save(`${residentSlug()}-care-card.pdf`);
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>;
  }
  if (denied || !resident) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-sm text-center bg-white rounded-2xl border border-gray-200 p-8">
          <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-gray-900">{denied ? "Staff sign-in required" : "Resident not found"}</h1>
          <p className="text-sm text-gray-500 mt-1">{denied ? "Log in with your staff account to view this resident card." : "This resident card is unavailable."}</p>
          {denied && <a href="/login" className="inline-block mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold">Go to login</a>}
        </div>
      </div>
    );
  }

  const name = `${s(resident.firstName)} ${s(resident.lastName)}`.trim() || "Resident";
  const yrs = age(resident.dateOfBirth);
  const allergies = effAllergies;

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4 print:bg-white print:py-0">
      <div className="max-w-4xl mx-auto bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden print:shadow-none print:border-0">
        {/* Title bar */}
        <div className="bg-[#2E4A48] text-white px-5 py-3 flex items-center justify-between">
          <span className="text-sm font-semibold uppercase tracking-wide flex items-center gap-2"><UserRound className="w-4 h-4" /> Resident Care Card</span>
          <button onClick={downloadFullPdf} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm font-semibold transition print:hidden">
            <FileDown className="w-4 h-4" /> Download PDF
          </button>
        </div>

        {/* Module 01 summary — photo, identity, status + field grid */}
        <div className="px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-start gap-4">
            {resident.photoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={s(resident.photoUrl)} alt="" className="w-14 h-14 rounded-full object-cover border border-gray-200 shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-[#2E4A48] text-white flex items-center justify-center shrink-0"><UserRound className="w-7 h-7" /></div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-extrabold text-gray-900 truncate">{name}</h1>
              <p className="mt-1 inline-flex items-center gap-1.5 rounded bg-gray-100 px-2 py-0.5 text-xs font-bold tracking-wide text-gray-800">
                <IdCard className="w-3.5 h-3.5 text-[#2E4A48]" /> {patientCode(s(resident.id))}
              </p>
              <p className="text-sm text-gray-500 mt-1">Room {s(resident.roomNumber) || "—"} · Admitted {fmtDate(resident.admissionDate)}{yrs != null ? ` · Age ${yrs}` : ""}</p>
            </div>
            <span className={`shrink-0 px-2.5 py-1 rounded text-[11px] font-bold uppercase border ${STATUS_META[s(resident.status)] || STATUS_META.ACTIVE}`}>{s(resident.status).replace(/_/g, " ") || "ACTIVE"}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3 mt-4">
            <Cell label="Primary Diagnosis" value={primaryDiagnosis} />
            <Cell label="Care Level" value={s(resident.careLevel).replace(/_/g, " ")} accent />
            <Cell label="Allergies" value={allergies} danger />
            <Cell label="Primary Physician" value={primaryPhysician} />
            <Cell label="Emergency Contact" value={[s(resident.emergencyContact), s(resident.emergencyContactPhone)].filter(Boolean).join(" · ")} />
            <Cell label="Diet Restriction" value={dietRestriction} accent />
          </div>
        </div>

        {/* Resident profile tab bar (Family/Emergency/Vaccines/ADL/Medical/Advance/Acuity) */}
        <div className="border-b border-gray-200 bg-gray-50/60 print:hidden">
          <div className="flex gap-0.5 overflow-x-auto px-3 no-scrollbar">
            {TABS.map(({ key, label, icon: Icon }) => {
              const on = tab === key;
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition ${
                    on ? "border-[#2E4A48] text-[#2E4A48]" : "border-transparent text-gray-500 hover:text-gray-800"
                  }`}
                >
                  <Icon className="w-4 h-4" /> {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Active tab panel */}
        <div className="px-5 py-5">
          {tab === "family" && (
            <Section title="Family & Sponsor" icon={Users}>
              {(sponsorName || sponsorEmail) ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                  <Cell label="Name" value={sponsorName} accent />
                  <Cell label="Role" value="Sponsor / billing contact" />
                  <Cell label="Phone" value={sponsorPhone} />
                  <Cell label="Email" value={sponsorEmail} />
                </div>
              ) : (
                <p className="text-sm text-gray-400">No family sponsor on record.</p>
              )}
            </Section>
          )}

          {tab === "emergency" && (
            <Section title="Emergency Contact" icon={Phone}>
              {resident.emergencyContact || resident.emergencyContactPhone ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                  <Cell label="Contact" value={s(resident.emergencyContact)} accent />
                  <Cell label="Phone" value={s(resident.emergencyContactPhone)} />
                </div>
              ) : (
                <p className="text-sm text-gray-400">No emergency contact on record.</p>
              )}
            </Section>
          )}

          {tab === "vaccines" && (
            <Section title={`Vaccinations (${vaccinations.length})`} icon={Syringe}>
              {vaccinations.length === 0 ? <p className="text-sm text-gray-400">No vaccination records.</p> : (
                <ul className="space-y-2">
                  {vaccinations.map((v) => (
                    <li key={s(v.id)} className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 p-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{s(v.vaccineName) || s(v.vaccineType) || "Vaccine"}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {[s(v.vaccineType).replace(/_/g, " "),
                            v.doseNumber ? `Dose ${s(v.doseNumber)}${v.totalDoses ? `/${s(v.totalDoses)}` : ""}` : "",
                            v.dateGiven ? `Given ${fmtDate(v.dateGiven)}` : v.scheduledDate ? `Scheduled ${fmtDate(v.scheduledDate)}` : "",
                          ].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </div>
                      <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${VAX_STATUS[s(v.status)] || VAX_STATUS.SCHEDULED}`}>{s(v.status).replace(/_/g, " ") || "—"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {tab === "adl" && (
            <Section title="ADL Baseline — Admission Assessment" icon={Activity}>
              {baseline?.domains && Object.keys(baseline.domains).length > 0 ? (
                <div className="space-y-2">
                  {Object.entries(baseline.domains).map(([k, d]) => (
                    <div key={k} className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 p-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">{ADL_DOMAIN_LABEL[k] || cap(k)}</p>
                        {d?.notes ? <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">{d.notes}</p> : null}
                      </div>
                      <span className="shrink-0 px-2 py-0.5 rounded text-[11px] font-semibold bg-[#2E4A48]/10 text-[#2E4A48] border border-[#2E4A48]/20">{d?.level || "—"}</span>
                    </div>
                  ))}
                  {baseline.note ? <p className="text-xs text-gray-500 whitespace-pre-wrap pt-1"><b className="text-gray-700">Summary:</b> {baseline.note}</p> : null}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No admission (12-domain) assessment on file for this resident.</p>
              )}
            </Section>
          )}

          {tab === "medical" && (
            <Section title="Medical History" icon={ClipboardList}>
              <div className="space-y-3">
                <KV label="Primary Diagnosis" value={primaryDiagnosis} />
                {effAssessment ? <KV label="Clinical Assessment" value={effAssessment} /> : null}
                <KV label="History" value={effHistory} />
                {resident.surgeries ? <KV label="Surgeries" value={s(resident.surgeries)} /> : null}
                {resident.hospitalizations ? <KV label="Hospitalizations" value={s(resident.hospitalizations)} /> : null}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">Allergies</p>
                  {allergyRecs.length > 0 ? (
                    <ul className="space-y-1.5">
                      {allergyRecs.map((a) => (
                        <li key={s(a.id)} className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 p-2">
                          <span className="text-sm text-gray-800"><AlertTriangle className="inline w-3.5 h-3.5 text-amber-500 mr-1 -mt-0.5" />{s(a.allergen)}{a.reaction ? <span className="text-gray-500"> — {s(a.reaction)}</span> : ""}<span className="text-[11px] text-gray-400"> · {s(a.type).replace(/_/g, " ")}</span></span>
                          <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${SEVERITY_META[s(a.severity)] || SEVERITY_META.MILD}`}>{s(a.severity).replace(/_/g, " ") || "—"}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={`text-sm ${allergies ? "text-red-600 font-semibold" : "text-gray-400"}`}>{allergies || "None on record."}</p>
                  )}
                </div>
              </div>
            </Section>
          )}

          {tab === "advance" && (
            <Section title="Advance Care Planning" icon={HeartPulse}>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold border border-gray-200 bg-gray-50 text-gray-700">Code status: {s(resident.codeStatus).replace(/_/g, " ") || "—"}</span>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold border ${resident.dnrStatus ? "bg-red-100 text-red-700 border-red-200" : "bg-emerald-100 text-emerald-700 border-emerald-200"}`}>
                    {resident.dnrStatus ? "DNR — Do Not Resuscitate" : "Full resuscitation"}
                  </span>
                </div>
                <KV label="Advance Directives" value={s(resident.advanceDirectives)} />
                {resident.livingWill ? <KV label="Living Will" value={s(resident.livingWill)} /> : null}
                <KV label="Healthcare Proxy" value={[s(resident.healthcareProxy), s(resident.healthcareProxyPhone)].filter(Boolean).join(" · ")} />
              </div>
            </Section>
          )}

          {tab === "acuity" && (
            <Section title="Care Acuity — Level of Care" icon={Gauge}>
              {acuity ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-bold bg-[#2E4A48] text-white">Level {s(acuity.level)} · {LOC_LEVEL_META.find((l) => l.level === Number(acuity.level))?.name || s(acuity.levelName)}</span>
                    <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-bold border border-gray-200 bg-gray-50 text-gray-700">Score {s(acuity.total)}/50</span>
                    <span className={`inline-flex items-center px-2.5 py-1 rounded text-[10px] font-bold uppercase border ${acuity.status === "APPROVED" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-amber-100 text-amber-700 border-amber-200"}`}>{s(acuity.status).replace(/_/g, " ")}</span>
                  </div>
                  <p className="text-xs text-gray-500">{[acuity.trigger ? `Trigger: ${s(acuity.trigger)}` : "", `Assessed ${fmtDate(acuity.decidedAt || acuity.createdAt)}`].filter(Boolean).join(" · ")}</p>
                  {acuity.scores && typeof acuity.scores === "object" ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {Object.entries(acuity.scores as Record<string, unknown>).map(([k, v]) => (
                        <div key={k} className="rounded-lg border border-gray-200 p-2 flex items-center justify-between">
                          <span className="text-xs text-gray-600">{ACUITY_DOMAIN_LABEL[k] || cap(k)}</span>
                          <span className="text-sm font-bold text-[#2E4A48]">{s(v)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {acuity.notes ? <p className="text-xs text-gray-500 whitespace-pre-wrap pt-1"><b className="text-gray-700">Notes:</b> {s(acuity.notes)}</p> : null}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No acuity (Level of Care) assessment recorded yet.</p>
              )}
            </Section>
          )}
        </div>

        {/* Operational sections — live care ops, kept below the profile tabs */}
        <div className="px-5 pb-5 space-y-4 border-t border-gray-100 pt-5">
          {/* Active medications */}
          <Section title={`Medications (${activeMeds.length})`} icon={Pill}>
            {activeMeds.length === 0 ? <p className="text-sm text-gray-400">No active medications.</p> : (
              <ul className="space-y-1.5">
                {activeMeds.map(m => (
                  <li key={s(m.id)} className="text-sm flex items-start gap-2">
                    <Pill className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
                    <span><span className="font-semibold text-gray-900">{s(m.name)}</span> {s(m.dosage)} · {s(m.frequency)}{m.route ? ` · ${s(m.route)}` : ""}{s(m.status) === "PENDING" ? " (pending approval)" : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Recent requests */}
          <Section title="Recent Requests" icon={ConciergeBell}>
            {recentRequests.length === 0 ? <p className="text-sm text-gray-400">No recent requests.</p> : (
              <ul className="space-y-1.5">
                {recentRequests.map(r => (
                  <li key={s(r.id)} className="text-sm flex items-start justify-between gap-2">
                    <span className="min-w-0"><span className="font-medium text-gray-900">{s(r.category).replace(/_/g, " ")}{r.subType ? ` — ${s(r.subType)}` : ""}</span>{r.details ? <span className="text-gray-500">: {s(r.details)}</span> : ""}</span>
                    <span className="shrink-0 text-[11px] font-semibold text-gray-500">{s(r.status)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Assignments / tasks to do */}
          <Section title={`Assignments / To-do (${openTasks.length})`} icon={CalendarClock}>
            {openTasks.length === 0 ? <p className="text-sm text-gray-400">Nothing outstanding.</p> : (
              <ul className="space-y-1.5">
                {openTasks.map(t => {
                  const notes = taskNotesOf(t as Record<string, unknown>);
                  return (
                  <li key={s(t.id)} className="text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 text-gray-900">{s(t.title)}{t.description ? <span className="text-gray-500"> — {s(t.description)}</span> : ""}</span>
                      <span className="shrink-0 text-[11px] text-gray-500">{t.dueDate ? `Due ${fmtDate(t.dueDate)}` : ""}</span>
                    </div>
                    {notes.length > 0 && (
                      <ul className="mt-1 space-y-1">
                        {notes.map(n => (
                          <li key={n.id} className="flex items-start gap-1.5 rounded bg-amber-50 border border-amber-200 px-2 py-1">
                            <StickyNote className="w-3 h-3 text-amber-600 mt-0.5 flex-shrink-0" />
                            <span className="text-[11px] text-gray-700 leading-snug"><b className="text-gray-800">Note:</b> {n.text}<span className="text-gray-400"> — {n.author}</span></span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                  );
                })}
              </ul>
            )}
          </Section>
          <p className="text-[11px] text-gray-400 text-center">Generated {fmt(new Date().toISOString())} · confidential — for authorized care staff only.</p>
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value, danger, accent }: { label: string; value: string; danger?: boolean; accent?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-sm mt-0.5 ${danger && value ? "text-red-600 font-semibold" : accent && value ? "text-[#2E4A48] font-semibold" : "text-gray-800"}`}>{value || "—"}</p>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-sm text-gray-800 whitespace-pre-wrap mt-0.5">{value || "—"}</p>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Pill; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-gray-500 flex items-center gap-1.5 mb-1.5"><Icon className="w-4 h-4 text-[#2E4A48]" /> {title}</p>
      {children}
    </div>
  );
}
