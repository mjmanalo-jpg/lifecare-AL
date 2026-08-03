"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertTriangle, Pill, ClipboardList, ConciergeBell, ShieldAlert,
  UserRound, Phone, CalendarClock, Loader2, FileDown,
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
      const [m, sr, tk] = await Promise.all([
        getJson(`/api/db/medications?f_residentId=${id}&take=100`),
        getJson(`/api/db/service-requests?f_residentId=${id}&take=100`),
        getJson(`/api/db/tasks?f_residentId=${id}&take=100`),
      ]);
      if (!alive) return;
      setMeds((m.data as Row[]) || []);
      setRequests((sr.data as Row[]) || []);
      setTasks((tk.data as Row[]) || []);
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
        {/* Header */}
        <div className="bg-[#2E4A48] text-white p-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/70"><UserRound className="w-4 h-4" /> Resident Care Card</div>
            <h1 className="text-2xl sm:text-3xl font-extrabold mt-1 truncate">{name}</h1>
            <p className="text-white/80 text-sm mt-0.5">
              Room {s(resident.roomNumber) || "—"} · {s(resident.careLevel) || "—"}
              {yrs != null && ` · ${yrs} yrs`} · DOB {fmtDate(resident.dateOfBirth)}
            </p>
          </div>
          <button onClick={downloadFullPdf} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm font-semibold transition print:hidden">
            <FileDown className="w-4 h-4" /> Download PDF
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Allergies — most safety-critical, always first */}
          <div className={`rounded-xl border p-3 ${allergies ? "border-red-300 bg-red-50" : "border-gray-200 bg-gray-50"}`}>
            <p className={`text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 mb-1 ${allergies ? "text-red-700" : "text-gray-500"}`}>
              <AlertTriangle className={`w-4 h-4 ${allergies ? "text-red-600" : "text-gray-400"}`} /> Allergies
            </p>
            <p className={`text-sm font-semibold ${allergies ? "text-red-800" : "text-gray-400"}`}>{allergies || "None on record"}</p>
          </div>

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

          {/* Emergency contact */}
          {(resident.emergencyContact || resident.emergencyContactPhone) && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 flex items-center gap-2">
              <Phone className="w-4 h-4 text-gray-400" /> <span className="font-semibold">Emergency:</span> {s(resident.emergencyContact) || "—"} {resident.emergencyContactPhone ? `· ${s(resident.emergencyContactPhone)}` : ""}
            </div>
          )}

          <p className="text-[11px] text-gray-400 text-center">Generated {fmt(new Date().toISOString())} · confidential — for authorized care staff only.</p>
        </div>
      </div>
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
