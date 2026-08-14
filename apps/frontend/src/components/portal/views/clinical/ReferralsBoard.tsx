"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Plus, X, Check, Ban, ClipboardCheck, UserRound, Truck, Search } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord } from "@/lib/api";
import { Clock, CalendarDays, CheckCircle2 } from "lucide-react";
import { ClinicalButton, ClinicalHeader } from "./clinical-ui";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const fmtD = (v: unknown) => (v ? new Date(s(v)).toLocaleDateString() : "—");
const toLocalInputValue = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
// The specialist/doctor name is persisted as the FIRST line of `notes`
// ("Specialist: <name>") — the appointment's structured extras (type,
// documents, escort, pre-appt notes, family-notified) follow on later lines.
// The card + transport modal only want the doctor name, so read line 1 only.
const specialistFromNotes = (v: unknown) => s(v).split("\n")[0].replace(/^Specialist:\s*/, "").trim();
const APPOINTMENT_TYPES = ["GP / Family Doctor", "Specialist", "Dental", "Laboratory", "Imaging / Radiology", "Therapy", "Follow-up", "Other"];
// The transport request the appointment/referral is wired to (if any). Status
// mirrors TransportRequest.status in the Fleet board.
const TRANSPORT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Transport requested — awaiting dispatch",
  APPROVED: "Transport approved — awaiting driver assignment",
  SCHEDULED: "Driver assigned",
  DECLINED: "Transport declined",
  COMPLETED: "Transport completed",
  CANCELLED: "Transport cancelled",
};

/**
 * Referrals & Appointments (Modules 13 + 15) — specialist referrals follow the
 * approval flow: Submit → Pending approval → Confirmed (scheduled) → Outcome
 * documented. A Care Manager gate approves/rejects before confirmation.
 */
export default function ReferralsBoard({ canApprove = false }: { canApprove?: boolean }) {
  const { data: rows, loading, refetch } = useLiveQuery<Row>("hospital-referrals", { query: "include=resident&take=400", tables: ["HospitalReferral"] });
  const { data: residentRows } = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });
  const residents = useMemo(() => residentRows.map(adaptResident), [residentRows]);

  // Fleet wiring: the same TransportRequest resource the Fleet board (FleetHub
  // → RequestsTab) and Driver portal read. A "Request Transport" action here
  // creates a PENDING request that surfaces on both boards for assignment.
  const { data: transportRows, refetch: refetchTransport } = useLiveQuery<Row>("transport-requests", { query: "take=400", tables: ["TransportRequest"] });
  const { data: driverRows } = useLiveQuery<Row>("drivers", { query: "take=300", tables: ["Driver"] });
  const { data: vehicleRows } = useLiveQuery<Row>("vehicles", { query: "take=300", tables: ["Vehicle"] });
  const drivers = useMemo(() => driverRows.map((d) => ({ id: s(d.id), name: s(d.name) || "Driver", isActive: d.isActive === true })).filter((d) => d.isActive), [driverRows]);
  const vehicles = useMemo(() => vehicleRows.map((v) => ({ id: s(v.id), name: s(v.name) || "Vehicle", plate: s(v.licensePlate), status: s(v.status) })), [vehicleRows]);
  // referralId → its transport request status/driver, resolved from transportRequestId on the referral.
  const transportById = useMemo(() => {
    const m = new Map<string, Row>();
    transportRows.forEach((t) => m.set(s(t.id), t));
    return m;
  }, [transportRows]);

  const [session, setSession] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
  useEffect(() => { fetch("/api/auth/session").then((r) => r.json()).then((d) => { if (d?.authenticated) setSession({ id: d.session?.userId ?? null, name: d.session?.name ?? "Clinician" }); }).catch(() => {}); }, []);

  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    residentId: "", appointmentType: APPOINTMENT_TYPES[0],
    specialist: "", facilityName: "", scheduledDate: "", reason: "", urgency: "ROUTINE",
    documentsNeeded: "", companion: "", preApptNotes: "", familyNotified: false,
  });

  const rname = (c: Row) => { const r = (c.resident ?? {}) as Row; return `${s(r.firstName)} ${s(r.lastName)}`.trim() || "—"; };
  // Card header leads with the RESIDENT — "Last, First · Room N" — since the
  // referral is about them; the specialist is a field below.
  const rHeader = (c: Row) => {
    const r = (c.resident ?? {}) as Row;
    const name = [s(r.lastName), s(r.firstName)].filter(Boolean).join(", ") || rname(c);
    const room = s(r.roomNumber);
    return room ? `${name} · Room ${room}` : name;
  };

  const filtered = useMemo(() => rows.filter((r) => {
    if (statusFilter !== "all" && s(r.status) !== statusFilter) return false;
    const query = search.trim().toLowerCase();
    if (!query) return true;
    const resident = (r.resident ?? {}) as Row;
    return [s(resident.firstName), s(resident.lastName), s(resident.roomNumber), specialistFromNotes(r.notes), s(r.facilityName), s(r.reason)]
      .some((value) => value.toLowerCase().includes(query));
  }), [rows, statusFilter, search]);
  const stats = useMemo(() => ({
    pending: rows.filter((r) => s(r.status) === "REQUESTED").length,
    scheduled: rows.filter((r) => s(r.status) === "SCHEDULED").length,
    completed: rows.filter((r) => s(r.status) === "COMPLETED").length,
    // Open appointments without an active transport request wired to the Fleet board.
    needsTransport: rows.filter((r) => {
      if (["COMPLETED", "CANCELLED"].includes(s(r.status))) return false;
      const req = s(r.transportRequestId) ? transportById.get(s(r.transportRequestId)) : undefined;
      return !req || ["DECLINED", "CANCELLED"].includes(s(req.status));
    }).length,
  }), [rows, transportById]);

  const submit = async () => {
    if (!form.residentId || !form.scheduledDate || !form.reason.trim()) { Swal.fire("Missing fields", "Resident, date & time, and referral reason are required.", "warning"); return; }
    setBusy(true);
    try {
      // Migration-free packing: only appointmentType, documentsNeeded, companion,
      // pre-appointment notes and familyNotified have no dedicated column, so they
      // ride in the free-text `notes` column as a readable block. Line 1 stays
      // "Specialist: <name>" so the card + transport modal keep extracting the
      // doctor name unchanged.
      const noteLines = [
        `Specialist: ${form.specialist.trim()}`,
        `Appointment Type: ${form.appointmentType}`,
        form.documentsNeeded.trim() && `Documents Needed: ${form.documentsNeeded.trim()}`,
        form.companion.trim() && `Companion / Escort: ${form.companion.trim()}`,
        `Family Notified: ${form.familyNotified ? "Yes" : "No"}`,
        form.preApptNotes.trim() && `Pre-Appointment Notes: ${form.preApptNotes.trim()}`,
      ].filter(Boolean);
      await createRecord("hospital-referrals", {
        residentId: form.residentId,
        facilityName: form.facilityName.trim() || "—",
        reason: form.reason.trim(),
        urgency: form.urgency,
        status: "REQUESTED",
        referredById: session.id,
        referredByName: session.name,
        scheduledDate: form.scheduledDate ? new Date(form.scheduledDate).toISOString() : null,
        notes: noteLines.join("\n"),
      });
      await refetch();
      setShowAdd(false);
      setForm({
        residentId: "", appointmentType: APPOINTMENT_TYPES[0],
        specialist: "", facilityName: "", scheduledDate: "", reason: "", urgency: "ROUTINE",
        documentsNeeded: "", companion: "", preApptNotes: "", familyNotified: false,
      });
      Swal.fire({ title: "Referral submitted", text: "Sent to Pending Approvals for nurse / care manager review.", icon: "success", timer: 1800, showConfirmButton: false });
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not submit.", "error"); }
    finally { setBusy(false); }
  };

  const patch = async (r: Row, data: Row, confirm?: { title: string; text: string; color?: string }) => {
    if (confirm) { const res = await Swal.fire({ title: confirm.title, text: confirm.text, icon: "question", showCancelButton: true, confirmButtonColor: confirm.color ?? "#3b82f6" }); if (!res.isConfirmed) return; }
    try { await updateRecord("hospital-referrals", s(r.id), data); await refetch(); } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not update.", "error"); }
  };

  const reject = async (r: Row) => { const res = await Swal.fire({ title: "Reject referral?", input: "textarea", inputLabel: "Reason", showCancelButton: true, confirmButtonColor: "#dc2626", confirmButtonText: "Reject" }); if (!res.isConfirmed) return; await patch(r, { status: "CANCELLED", rejectionReason: res.value || "Rejected" }); };
  const schedule = async (r: Row) => { const res = await Swal.fire({ title: "Confirm & schedule", input: "text", inputLabel: "Appointment date (YYYY-MM-DD)", inputValue: new Date().toISOString().slice(0, 10), showCancelButton: true }); if (!res.isConfirmed) return; await patch(r, { status: "SCHEDULED", scheduledDate: new Date(res.value || Date.now()).toISOString() }); };
  const complete = async (r: Row) => { const res = await Swal.fire({ title: "Document outcome", input: "textarea", inputLabel: "Findings, follow-up & notes", showCancelButton: true, confirmButtonText: "Complete", confirmButtonColor: "#16a34a" }); if (!res.isConfirmed) return; await patch(r, { status: "COMPLETED", outcome: res.value || "Completed", completedAt: new Date().toISOString() }); };

  // ── Transport-request wiring ──────────────────────────────────────────────
  // The referral carries transportRequestId (Prisma column) once wired, so no
  // link map is needed. Fleet dispatch (FleetHub → RequestsTab) reads the same
  // "transport-requests" resource and, once assigned, the Driver portal sees it.
  const [reqFor, setReqFor] = useState<Row | null>(null);
  const [reqForm, setReqForm] = useState({ pickupLocation: "Golden Hearth Facility", destination: "", requestedDate: "", driverId: "", vehicleId: "" });
  const [reqBusy, setReqBusy] = useState(false);
  const openRequest = (r: Row) => {
    setReqForm({
      pickupLocation: "Golden Hearth Facility",
      destination: s(r.facilityName) || s(r.reason) || "",
      requestedDate: toLocalInputValue(s(r.scheduledDate) ? new Date(s(r.scheduledDate)) : new Date()),
      driverId: "", vehicleId: "",
    });
    setReqFor(r);
  };
  const submitRequest = async () => {
    if (!reqFor) return;
    if (!reqForm.destination.trim() || !reqForm.requestedDate) { Swal.fire("Missing fields", "Destination and pickup date/time are required.", "warning"); return; }
    // If a driver is picked, a vehicle is required so a Trip can be scheduled.
    if (reqForm.driverId && !reqForm.vehicleId) { Swal.fire("Vehicle needed", "Select a vehicle to assign the chosen driver.", "warning"); return; }
    setReqBusy(true);
    try {
      const specialist = specialistFromNotes(reqFor.notes);
      const created = await createRecord("transport-requests", {
        residentId: s(reqFor.residentId),
        type: "MEDICAL_APPOINTMENT",
        pickupLocation: reqForm.pickupLocation.trim() || "Golden Hearth Facility",
        dropoffLocation: reqForm.destination.trim(),
        destination: reqForm.destination.trim(),
        purpose: s(reqFor.reason) || (specialist ? `Appointment — ${specialist}` : "Medical appointment"),
        requestedDate: new Date(reqForm.requestedDate).toISOString(),
        priority: s(reqFor.urgency) === "EMERGENCY" ? "EMERGENCY" : s(reqFor.urgency) === "URGENT" ? "HIGH" : "NORMAL",
        status: reqForm.driverId ? "SCHEDULED" : "PENDING",
        source: "PORTAL",
        notes: `Auto-created from Medical Appointment for ${rname(reqFor)}.`,
      });
      const requestId = s((created as { data?: Row })?.data?.id);
      // Assign-on-create: build the Trip so the driver sees it immediately.
      if (requestId && reqForm.driverId && reqForm.vehicleId) {
        await createRecord("trips", {
          requestId,
          residentId: s(reqFor.residentId),
          vehicleId: reqForm.vehicleId,
          driverId: reqForm.driverId,
          pickupLocation: reqForm.pickupLocation.trim() || "Golden Hearth Facility",
          dropoffLocation: reqForm.destination.trim(),
          destination: reqForm.destination.trim(),
          origin: reqForm.pickupLocation.trim() || "Golden Hearth Facility",
          scheduledAt: new Date(reqForm.requestedDate).toISOString(),
          status: "SCHEDULED",
          notes: s(reqFor.reason) || null,
        });
      }
      // Link the request back onto the referral + flip the transport flag.
      if (requestId) await updateRecord("hospital-referrals", s(reqFor.id), { transportRequestId: requestId, transportArranged: true });
      await Promise.all([refetch(), refetchTransport()]);
      setReqFor(null);
      Swal.fire({ title: reqForm.driverId ? "Transport assigned" : "Transport requested", text: reqForm.driverId ? "Trip scheduled — the driver has been notified." : "Sent to Fleet dispatch for driver assignment.", icon: "success", timer: 2000, showConfirmButton: false });
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not create transport request.", "error"); }
    finally { setReqBusy(false); }
  };

  return (
    <div className="-m-4 min-h-full space-y-5 bg-[var(--clinical-ground)] p-4 sm:-m-6 sm:p-6">
      {/* Header banner */}
      <ClinicalHeader
        title="Medical Appointments"
        subtitle="Coordinate referrals, approvals, transport, scheduling, and outcomes in one place."
        right={<ClinicalButton onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> New Referral</ClinicalButton>}
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-[var(--clinical-line)] lg:grid-cols-4" style={{ borderColor: "var(--clinical-line)" }}>
        <Stat label="Pending Approval" value={String(stats.pending)} color="#D97706" icon={Clock} />
        <Stat label="Scheduled" value={String(stats.scheduled)} color="#2563EB" icon={CalendarDays} />
        <Stat label="Completed" value={String(stats.completed)} color="#16A34A" icon={CheckCircle2} />
        <Stat label="Needs Transport" value={String(stats.needsTransport)} color="#DC2626" icon={Truck} />
      </div>

      {/* Filter chips */}
      <div className="flex flex-col gap-3 rounded-2xl border p-3 lg:flex-row lg:items-center" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--clinical-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resident, specialist, clinic, or purpose..." className="min-h-11 w-full rounded-xl border bg-[var(--clinical-surface)] py-2.5 pl-10 pr-4 text-sm text-[var(--clinical-ink)] outline-none transition focus:border-[var(--clinical-focus)] focus:ring-2 focus:ring-[var(--clinical-focus)]/20" style={{ borderColor: "var(--clinical-line)" }} />
        </div>
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-[var(--clinical-surface-2)] p-1">
          {["all", "REQUESTED", "APPROVED", "SCHEDULED", "COMPLETED", "CANCELLED"].map((st) => (
            <button key={st} onClick={() => setStatusFilter(st)} className={`min-h-9 shrink-0 rounded-lg px-3 text-xs font-semibold transition ${statusFilter === st ? "bg-[var(--clinical-panel)] text-white shadow-sm" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}>{st === "all" ? "All" : st.charAt(0) + st.slice(1).toLowerCase()}</button>
          ))}
        </div>
      </div>

      {/* Record cards */}
      <div className="space-y-3">
        {loading && filtered.length === 0 ? <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-400">Loading…</div>
          : filtered.length === 0 ? <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-400">No referrals.</div>
          : filtered.map((r) => {
            const st = s(r.status);
            const urg = s(r.urgency) || "ROUTINE";
            const specialist = specialistFromNotes(r.notes);
            const accent = urg === "EMERGENCY" ? "#DC2626" : urg === "URGENT" ? "#F59E0B" : "#2563EB";
            const linkedReqId = s(r.transportRequestId);
            const transportReq = linkedReqId ? transportById.get(linkedReqId) : undefined;
            const transportStatus = transportReq ? s(transportReq.status) : "";
            // Active transport requests block a duplicate; declined/cancelled re-open the button.
            const transportActive = !!transportReq && !["DECLINED", "CANCELLED"].includes(transportStatus);
            return (
              <div key={s(r.id)} className="rounded-2xl border p-4 transition hover:border-[var(--clinical-line-strong)] sm:p-5" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <UrgencyBadge urgency={urg} />
                    <StatusBadge status={st} />
                    {transportActive && <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700"><Truck className="w-3.5 h-3.5" /> Transport</span>}
                    <span className="inline-flex items-center gap-1.5 font-bold text-[var(--clinical-ink)]"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} /><UserRound className="h-4 w-4 text-[var(--clinical-muted)]" />{rHeader(r)}</span>
                  </div>
                  {s(r.scheduledDate) && <span className="rounded-lg bg-[var(--clinical-surface-2)] px-2.5 py-1 text-xs font-semibold text-[var(--clinical-muted)]">{fmtD(r.scheduledDate)}</span>}
                </div>

                <div className="grid grid-cols-1 gap-3 rounded-xl bg-[var(--clinical-surface-2)] p-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Detail label="Specialist" value={specialist || "—"} />
                  <Detail label="Clinic" value={s(r.facilityName) || "—"} />
                  <Detail label="Purpose" value={s(r.reason) || "—"} />
                  <Detail label={r.approvedByName ? "Approved By" : "Submitted By"} value={s(r.approvedByName) || s(r.referredByName) || rname(r)} />
                </div>

                {r.rejectionReason && <p className="text-sm text-red-600 font-medium mt-3">Rejected: {s(r.rejectionReason)}</p>}

                {r.outcome && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-green-50 border border-green-200 p-3">
                    <Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                    <p className="text-sm text-slate-700"><span className="font-semibold">Outcome:</span> {s(r.outcome)}</p>
                  </div>
                )}

                {st === "REQUESTED" && (
                  <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 text-sm">
                    Pending approval — nurse or care manager will approve/reject this in <b>Pending Approvals</b>, then confirm &amp; schedule here.
                  </div>
                )}

                {/* Transport — wired to Fleet Management as a driver-assignable request */}
                {transportActive ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-700">
                    <Truck className="w-4 h-4 shrink-0" />
                    <span className="font-semibold">{TRANSPORT_STATUS_LABEL[transportStatus] || `Transport: ${transportStatus}`}</span>
                    {transportStatus === "DECLINED" && transportReq && s(transportReq.declineReason) && <span className="text-red-600">— {s(transportReq.declineReason)}</span>}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {!transportActive && st !== "CANCELLED" && (
                    <ClinicalButton variant="secondary" onClick={() => openRequest(r)} className="!min-h-9 !px-3.5 !text-xs"><Truck className="h-3.5 w-3.5" /> Request Transport</ClinicalButton>
                  )}
                  {st === "APPROVED" && canApprove && (<>
                    <button onClick={() => reject(r)} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition"><Ban className="w-3.5 h-3.5" /> Reject</button>
                    <button onClick={() => schedule(r)} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 text-white text-xs font-semibold hover:bg-slate-900 transition"><CalendarClock className="w-3.5 h-3.5" /> Confirm &amp; schedule</button>
                  </>)}
                  {st === "SCHEDULED" && <button onClick={() => complete(r)} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 transition"><ClipboardCheck className="w-3.5 h-3.5" /> Document outcome</button>}
                </div>
              </div>
            );
          })}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 bg-[#2E4A48] px-5 py-4 text-white">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15"><CalendarClock className="h-5 w-5" /></span>
                <div>
                  <h2 className="text-lg font-bold leading-tight tracking-tight">New Referral / Appointment</h2>
                  <p className="text-xs font-medium text-white/70">Coordinate a specialist appointment or referral</p>
                </div>
              </div>
              <button onClick={() => setShowAdd(false)} className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/20 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 p-6">
              <div><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Resident <span className="text-[#C0573F]">*</span></label>
                <select value={form.residentId} onChange={(e) => setForm({ ...form, residentId: e.target.value })} className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-[#2E4A48]/30"><option value="">Select resident…</option>{residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}</select></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2"><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Appointment Type <span className="text-[#C0573F]">*</span></label><select value={form.appointmentType} onChange={(e) => setForm({ ...form, appointmentType: e.target.value })} className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-[#2E4A48]/30">{APPOINTMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
                <div className="sm:col-span-2"><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Date &amp; Time <span className="text-[#C0573F]">*</span></label><input type="datetime-local" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 outline-none focus:ring-2 focus:ring-[#2E4A48]/30" /></div>
                <div><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Specialist / Doctor Name</label><input value={form.specialist} onChange={(e) => setForm({ ...form, specialist: e.target.value })} placeholder="e.g. Dr. Santos" className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 outline-none focus:ring-2 focus:ring-[#2E4A48]/30" /></div>
                <div><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Clinic / Hospital</label><input value={form.facilityName} onChange={(e) => setForm({ ...form, facilityName: e.target.value })} placeholder="e.g. St. Luke's Medical Center" className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 outline-none focus:ring-2 focus:ring-[#2E4A48]/30" /></div>
                <div className="sm:col-span-2"><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Referral Reason / Purpose <span className="text-[#C0573F]">*</span></label><textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2} placeholder="Reason for appointment or referral details…" className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 outline-none focus:ring-2 focus:ring-[#2E4A48]/30" /></div>
                <div><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Documents Needed</label><input value={form.documentsNeeded} onChange={(e) => setForm({ ...form, documentsNeeded: e.target.value })} placeholder="e.g. Lab results, referral letter, ID" className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 outline-none focus:ring-2 focus:ring-[#2E4A48]/30" /></div>
                <div><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Companion / Escort Assigned</label><input value={form.companion} onChange={(e) => setForm({ ...form, companion: e.target.value })} placeholder="e.g. Nurse Maria, Family member" className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 outline-none focus:ring-2 focus:ring-[#2E4A48]/30" /></div>
                <div className="sm:col-span-2"><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Pre-Appointment Notes</label><textarea value={form.preApptNotes} onChange={(e) => setForm({ ...form, preApptNotes: e.target.value })} rows={2} placeholder="Preparation instructions, fasting requirements, items to bring…" className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 outline-none focus:ring-2 focus:ring-[#2E4A48]/30" /></div>
                <div><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Urgency</label><select value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })} className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-[#2E4A48]/30">{["ROUTINE", "URGENT", "EMERGENCY"].map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
              </div>
              {/* Family Notified toggle — no Transport Required control (transport is arranged separately via the Request Transport action on each card). */}
              <label className="flex items-center justify-between gap-3 rounded-lg bg-[#F0F1EA] px-4 py-3 cursor-pointer">
                <span className="flex items-center gap-3">
                  <UserRound className="w-5 h-5 text-[#2E4A48]" />
                  <span><span className="block text-sm font-semibold text-[#2B2B27]">Family Notified</span><span className="block text-xs text-[#8A8D82]">Family has been informed of this appointment</span></span>
                </span>
                <button type="button" role="switch" aria-checked={form.familyNotified} onClick={() => setForm({ ...form, familyNotified: !form.familyNotified })} className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${form.familyNotified ? "bg-[#2E4A48]" : "bg-[#C7CABD]"}`}>
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${form.familyNotified ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
              </label>
            </div>
            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-[#D6D8CD] bg-[#F0F1EA] px-6 py-4"><button onClick={() => setShowAdd(false)} disabled={busy} className="rounded-lg px-4 py-2 text-[#2B2B27] hover:bg-[#E1E3D9] disabled:opacity-50">Cancel</button><button onClick={submit} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-[#2E4A48] hover:bg-[#25403D] px-6 py-2 font-semibold text-white shadow-sm disabled:opacity-50"><CalendarClock className="w-4 h-4" /> {busy ? "Scheduling…" : "Schedule Appointment"}</button></div>
          </div>
        </div>
      )}

      {reqFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 bg-[#2E4A48] px-5 py-4 text-white">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15"><Truck className="h-5 w-5" /></span>
                <div>
                  <h2 className="text-lg font-bold leading-tight tracking-tight">Request Transport</h2>
                  <p className="text-xs font-medium text-white/70">Arrange a driver-assigned trip for this appointment</p>
                </div>
              </div>
              <button onClick={() => setReqFor(null)} className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/20 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 p-6">
              <div className="rounded-lg bg-[#F0F1EA] px-3 py-2 text-sm text-[#2B2B27]"><span className="font-semibold">{rname(reqFor)}</span>{s(reqFor.scheduledDate) && <> · {fmtD(reqFor.scheduledDate)}</>}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Pickup</label><input value={reqForm.pickupLocation} onChange={(e) => setReqForm({ ...reqForm, pickupLocation: e.target.value })} className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 outline-none focus:ring-2 focus:ring-[#2E4A48]/30" /></div>
                <div><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Destination <span className="text-[#C0573F]">*</span></label><input value={reqForm.destination} onChange={(e) => setReqForm({ ...reqForm, destination: e.target.value })} placeholder="Clinic / hospital" className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 outline-none focus:ring-2 focus:ring-[#2E4A48]/30" /></div>
                <div className="sm:col-span-2"><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Pickup date &amp; time <span className="text-[#C0573F]">*</span></label><input type="datetime-local" value={reqForm.requestedDate} onChange={(e) => setReqForm({ ...reqForm, requestedDate: e.target.value })} className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 outline-none focus:ring-2 focus:ring-[#2E4A48]/30" /></div>
                <div><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Assign driver <span className="text-[#8A8D82] font-normal">(optional)</span></label><select value={reqForm.driverId} onChange={(e) => setReqForm({ ...reqForm, driverId: e.target.value })} className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-[#2E4A48]/30"><option value="">Leave to dispatch</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
                <div><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Vehicle {reqForm.driverId && <span className="text-[#C0573F]">*</span>}</label><select value={reqForm.vehicleId} onChange={(e) => setReqForm({ ...reqForm, vehicleId: e.target.value })} disabled={!reqForm.driverId} className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-[#2E4A48]/30 disabled:opacity-50"><option value="">Select…</option>{vehicles.filter((v) => v.status !== "MAINTENANCE").map((v) => <option key={v.id} value={v.id}>{v.name}{v.plate ? ` (${v.plate})` : ""}</option>)}</select></div>
              </div>
              <p className="text-xs text-[#8A8D82]">Creates a Fleet transport request. Leave the driver unassigned to send it to dispatch, or assign a driver &amp; vehicle now to schedule the trip directly.</p>
            </div>
            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-[#D6D8CD] bg-[#F0F1EA] px-6 py-4"><button onClick={() => setReqFor(null)} disabled={reqBusy} className="rounded-lg px-4 py-2 text-[#2B2B27] hover:bg-[#E1E3D9] disabled:opacity-50">Cancel</button><button onClick={submitRequest} disabled={reqBusy} className="inline-flex items-center gap-2 rounded-lg bg-[#2E4A48] hover:bg-[#25403D] px-6 py-2 font-semibold text-white shadow-sm disabled:opacity-50"><Truck className="w-4 h-4" /> {reqBusy ? "Sending…" : reqForm.driverId ? "Assign & schedule" : "Request transport"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color, icon: Icon }: { label: string; value: string; color: string; icon: typeof Truck }) {
  return (
    <div className="bg-[var(--clinical-surface)] p-4 sm:p-5">
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--clinical-muted)]">{label}</span>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--clinical-surface-2)]" style={{ color }}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-2 text-3xl font-bold leading-none" style={{ color }}>{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-[var(--clinical-ink)]">{value}</p>
    </div>
  );
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const cls = urgency === "EMERGENCY" ? "bg-red-100 text-red-700" : urgency === "URGENT" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600";
  return <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] ${cls}`}>{urgency}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  const cls = status === "CANCELLED" ? "bg-red-500" : status === "COMPLETED" ? "bg-green-600" : status === "REQUESTED" ? "bg-amber-500" : "bg-slate-700";
  return <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-white ${cls}`}>{label}</span>;
}
