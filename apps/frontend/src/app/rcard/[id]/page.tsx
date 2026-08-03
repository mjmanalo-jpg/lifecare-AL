"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Pill, ClipboardList, ConciergeBell, ShieldAlert,
  UserRound, CalendarClock, Loader2, FileDown,
} from "lucide-react";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const fmt = (v: unknown) => (v ? new Date(s(v)).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
const fmtDate = (v: unknown) => (v ? new Date(s(v)).toLocaleDateString() : "—");
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

async function getJson(url: string) {
  try { const r = await fetch(url, { credentials: "include" }); if (!r.ok) return { ok: false, status: r.status, data: null }; const j = await r.json(); return { ok: true, status: 200, data: j?.data ?? null }; }
  catch { return { ok: false, status: 0, data: null }; }
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
      setResident(res.data as Row | null);
      const [m, sr, tk, pc, dt] = await Promise.all([
        getJson(`/api/db/medications?f_residentId=${id}&take=100`),
        getJson(`/api/db/service-requests?f_residentId=${id}&take=100`),
        getJson(`/api/db/tasks?f_residentId=${id}&take=100`),
        getJson(`/api/db/physician-communications?f_residentId=${id}&take=50`),
        getJson(`/api/db/diet-orders?f_residentId=${id}&take=50`),
      ]);
      if (!alive) return;
      setMeds((m.data as Row[]) || []);
      setRequests((sr.data as Row[]) || []);
      setTasks((tk.data as Row[]) || []);
      setComms((pc.data as Row[]) || []);
      setDiets((dt.data as Row[]) || []);
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
    doc.setFont("helvetica", "bold").setFontSize(14).text(name, M, y); y += 16;
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(100).text(`Room ${s(resident.roomNumber) || "—"} · ${s(resident.careLevel) || "—"} · DOB ${fmtDate(resident.dateOfBirth)}${age(resident.dateOfBirth) != null ? ` · ${age(resident.dateOfBirth)} yrs` : ""}`, M, y); y += 24;

    heading("Allergies"); body(s(resident.allergies) || "None on record");
    heading("Medical History"); body(s(resident.medicalHistory));
    heading(`Medications (${activeMeds.length})`);
    activeMeds.length ? activeMeds.forEach(m => body(`• ${s(m.name)} ${s(m.dosage)} · ${s(m.frequency)}${m.route ? ` · ${s(m.route)}` : ""}`)) : body("None active");
    heading("Recent Requests");
    recentRequests.length ? recentRequests.forEach(r => body(`• ${s(r.category).replace(/_/g, " ")}${r.subType ? ` — ${s(r.subType)}` : ""}: ${s(r.details)} [${s(r.status)}]`)) : body("None");
    heading("Assignments / To-do");
    openTasks.length ? openTasks.forEach(t => body(`• ${s(t.title)}${t.dueDate ? ` (due ${fmtDate(t.dueDate)})` : ""}`)) : body("Nothing outstanding");
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
  const allergies = s(resident.allergies);

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4 print:bg-white print:py-0">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden print:shadow-none print:border-0">
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
              <p className="text-sm text-gray-500 mt-0.5">Room {s(resident.roomNumber) || "—"} · Admitted {fmtDate(resident.admissionDate)}{yrs != null ? ` · Age ${yrs}` : ""}</p>
            </div>
            <span className={`shrink-0 px-2.5 py-1 rounded text-[11px] font-bold uppercase border ${STATUS_META[s(resident.status)] || STATUS_META.ACTIVE}`}>{s(resident.status).replace(/_/g, " ") || "ACTIVE"}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3 mt-4">
            <Cell label="Primary Diagnosis" value={s(resident.diagnosis)} />
            <Cell label="Care Level" value={s(resident.careLevel).replace(/_/g, " ")} accent />
            <Cell label="Allergies" value={allergies} danger />
            <Cell label="Primary Physician" value={primaryPhysician} />
            <Cell label="Emergency Contact" value={[s(resident.emergencyContact), s(resident.emergencyContactPhone)].filter(Boolean).join(" · ")} />
            <Cell label="Diet Restriction" value={dietRestriction} accent />
          </div>
        </div>

        <div className="px-5 py-5 space-y-4">
          {/* Medical history */}
          <Section title="Medical History" icon={ClipboardList}>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{s(resident.medicalHistory) || "—"}</p>
          </Section>

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
                {openTasks.map(t => (
                  <li key={s(t.id)} className="text-sm flex items-start justify-between gap-2">
                    <span className="min-w-0 text-gray-900">{s(t.title)}{t.description ? <span className="text-gray-500"> — {s(t.description)}</span> : ""}</span>
                    <span className="shrink-0 text-[11px] text-gray-500">{t.dueDate ? `Due ${fmtDate(t.dueDate)}` : ""}</span>
                  </li>
                ))}
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

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Pill; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-gray-500 flex items-center gap-1.5 mb-1.5"><Icon className="w-4 h-4 text-[#2E4A48]" /> {title}</p>
      {children}
    </div>
  );
}
