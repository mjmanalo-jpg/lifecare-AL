"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Plus, Check, Ban, ClipboardCheck, UserRound, Truck, Search, Info, Clock, CalendarDays, CheckCircle2 } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord } from "@/lib/api";
import { ClinicalButton, ClinicalHeader, ClinicalModal, controlClass, FieldLabel } from "./clinical-ui";

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

// One place for the palette so status, urgency, dots, and banners all read from
// the same tuned indigo/rose/amber/emerald tokens (dark-safe) — no more raw
// saturated hexes or the legacy sage colours fighting each other on one screen.
const softTint = (c: string) => `color-mix(in srgb, ${c} 14%, var(--clinical-surface))`;

/**
 * Referrals & Appointments (Modules 13 + 15) — specialist referrals follow the
 * approval flow: Submit → Pending approval → Confirmed (scheduled) → Outcome
 * documented. A Care Manager gate approves/rejects before confirmation.
 */
export default function ReferralsBoard({ canApprove = false }: { canApprove?: boolean }) {
  const { data: rows, loading, refetch } = useLiveQuery<Row>("hospital-referrals", { query: "include=resident&take=400", tables: ["HospitalReferral"] });
  const { data: residentRows } = useLiveQuery<Row>("residents", { query: "include=sponsor&take=300", tables: ["Resident"] });
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
      const created = await createRecord("hospital-referrals", {
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
      // Family-approval routing: when "Family Notified" is on, alert the sponsor so
      // they can approve/decline it in their Requests & Approvals. It stays
      // REQUESTED until the family (or the 24h auto-approve cron) schedules it.
      if (form.familyNotified) {
        const resRaw = residentRows.find((r) => s(r.id) === form.residentId);
        const sponsor = (resRaw?.sponsor ?? null) as Row | null;
        const sponsorId = sponsor?.id ? s(sponsor.id) : "";
        if (sponsorId) {
          createRecord("notifications", {
            userId: sponsorId,
            type: "SERVICE_UPDATE",
            title: "Appointment needs your approval",
            message: `A ${form.appointmentType}${form.specialist.trim() ? ` with ${form.specialist.trim()}` : ""} was requested for your relative. Review and approve or decline it in Requests & Approvals — it auto-approves after 24h if no response.`,
            relatedEntityType: "referral",
            relatedEntityId: created && typeof created === "object" ? s((created as Row).id) : undefined,
            severity: "WARNING",
          }).catch(() => null);
        }
      }
      await refetch();
      setShowAdd(false);
      setForm({
        residentId: "", appointmentType: APPOINTMENT_TYPES[0],
        specialist: "", facilityName: "", scheduledDate: "", reason: "", urgency: "ROUTINE",
        documentsNeeded: "", companion: "", preApptNotes: "", familyNotified: false,
      });
      Swal.fire({ title: "Referral submitted", text: form.familyNotified ? "Sent to the family sponsor for approval — auto-approves after 24h." : "Sent to Pending Approvals for nurse / care manager review.", icon: "success", timer: 2200, showConfirmButton: false });
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not submit.", "error"); }
    finally { setBusy(false); }
  };

  // ── Reject wiring ─────────────────────────────────────────────────────────
  const [rejectFor, setRejectFor] = useState<Row | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);
  const reject = (r: Row) => { setRejectReason(""); setRejectFor(r); };
  const submitReject = async () => {
    if (!rejectFor) return;
    setRejectBusy(true);
    try {
      await updateRecord("hospital-referrals", s(rejectFor.id), { status: "CANCELLED", rejectionReason: rejectReason.trim() || "Rejected" });
      await refetch();
      setRejectFor(null);
      Swal.fire({ title: "Referral rejected", text: "The family and requester can see the reason on the record.", icon: "success", timer: 1900, showConfirmButton: false });
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not reject.", "error"); }
    finally { setRejectBusy(false); }
  };

  // ── Confirm & schedule wiring ─────────────────────────────────────────────
  const [schedFor, setSchedFor] = useState<Row | null>(null);
  const [schedDate, setSchedDate] = useState("");
  const [schedBusy, setSchedBusy] = useState(false);
  const schedule = (r: Row) => { setSchedDate(s(r.scheduledDate) ? toLocalInputValue(new Date(s(r.scheduledDate))) : toLocalInputValue(new Date())); setSchedFor(r); };
  const submitSchedule = async () => {
    if (!schedFor) return;
    if (!schedDate) { Swal.fire("Pick a date", "Choose the confirmed appointment date and time.", "warning"); return; }
    setSchedBusy(true);
    try {
      await updateRecord("hospital-referrals", s(schedFor.id), { status: "SCHEDULED", scheduledDate: new Date(schedDate).toISOString() });
      await refetch();
      setSchedFor(null);
      Swal.fire({ title: "Appointment scheduled", text: "It now appears on the Appointment Calendar.", icon: "success", timer: 1900, showConfirmButton: false });
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not schedule.", "error"); }
    finally { setSchedBusy(false); }
  };

  // ── Document-outcome wiring ───────────────────────────────────────────────
  // Replaces the bare Swal prompt with a designed modal. Findings ride in the
  // free-text `outcome` column (migration-free); a follow-up line is appended
  // when the toggle is on so it reads back cleanly on the card.
  const OUTCOME_RESULTS = ["Seen — routine", "Seen — findings noted", "Treatment given", "Referred onward", "Did not attend", "Rescheduled"];
  const [outcomeFor, setOutcomeFor] = useState<Row | null>(null);
  const [outcomeForm, setOutcomeForm] = useState({ result: OUTCOME_RESULTS[0], findings: "", followUp: false, followUpDate: "" });
  const [outcomeBusy, setOutcomeBusy] = useState(false);
  const complete = (r: Row) => { setOutcomeForm({ result: OUTCOME_RESULTS[0], findings: "", followUp: false, followUpDate: "" }); setOutcomeFor(r); };
  const submitOutcome = async () => {
    if (!outcomeFor) return;
    if (!outcomeForm.findings.trim()) { Swal.fire("Add the findings", "Enter what happened at the appointment before completing it.", "warning"); return; }
    setOutcomeBusy(true);
    try {
      const followUp = outcomeForm.followUp
        ? `Follow-up required${outcomeForm.followUpDate ? ` by ${new Date(outcomeForm.followUpDate).toLocaleDateString()}` : ""}.`
        : "";
      const outcome = [`${outcomeForm.result}: ${outcomeForm.findings.trim()}`, followUp].filter(Boolean).join(" ");
      await updateRecord("hospital-referrals", s(outcomeFor.id), { status: "COMPLETED", outcome, completedAt: new Date().toISOString() });
      await refetch();
      setOutcomeFor(null);
      Swal.fire({ title: "Outcome recorded", text: "The appointment has been marked completed.", icon: "success", timer: 1900, showConfirmButton: false });
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not save the outcome.", "error"); }
    finally { setOutcomeBusy(false); }
  };

  // ── Transport-request wiring ──────────────────────────────────────────────
  // The referral carries transportRequestId (Prisma column) once wired, so no
  // link map is needed. Fleet dispatch (FleetHub → RequestsTab) reads the same
  // "transport-requests" resource and, once assigned, the Driver portal sees it.
  const [reqFor, setReqFor] = useState<Row | null>(null);
  const [reqForm, setReqForm] = useState({ pickupLocation: "LifeCare Facility", destination: "", requestedDate: "", driverId: "", vehicleId: "" });
  const [reqBusy, setReqBusy] = useState(false);
  const openRequest = (r: Row) => {
    setReqForm({
      pickupLocation: "LifeCare Facility",
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
        pickupLocation: reqForm.pickupLocation.trim() || "LifeCare Facility",
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
          pickupLocation: reqForm.pickupLocation.trim() || "LifeCare Facility",
          dropoffLocation: reqForm.destination.trim(),
          destination: reqForm.destination.trim(),
          origin: reqForm.pickupLocation.trim() || "LifeCare Facility",
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

      {/* Stat cards — one tuned palette (amber / indigo / emerald / rose) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pending Approval" value={String(stats.pending)} accent="var(--clinical-amber)" icon={Clock} />
        <Stat label="Scheduled" value={String(stats.scheduled)} accent="var(--clinical-panel)" icon={CalendarDays} />
        <Stat label="Completed" value={String(stats.completed)} accent="var(--clinical-green)" icon={CheckCircle2} />
        <Stat label="Needs Transport" value={String(stats.needsTransport)} accent="var(--clinical-coral)" icon={Truck} />
      </div>

      {/* Search + filter chips */}
      <div className="flex flex-col gap-3 rounded-2xl border p-3 lg:flex-row lg:items-center" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--clinical-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resident, specialist, clinic, or purpose..." className="min-h-11 w-full rounded-xl border bg-[var(--clinical-surface)] py-2.5 pl-10 pr-4 text-sm text-[var(--clinical-ink)] outline-none transition focus:border-[var(--clinical-focus)] focus:ring-2 focus:ring-[var(--clinical-focus)]/20" style={{ borderColor: "var(--clinical-line-strong)" }} />
        </div>
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-[var(--clinical-surface-2)] p-1">
          {["all", "REQUESTED", "APPROVED", "SCHEDULED", "COMPLETED", "CANCELLED"].map((st) => (
            <button key={st} onClick={() => setStatusFilter(st)} className={`min-h-9 shrink-0 rounded-lg px-3 text-xs font-semibold transition ${statusFilter === st ? "bg-[var(--clinical-panel)] text-white shadow-sm" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}>{st === "all" ? "All" : st.charAt(0) + st.slice(1).toLowerCase()}</button>
          ))}
        </div>
      </div>

      {/* Record cards */}
      <div className="space-y-3">
        {loading && filtered.length === 0 ? <EmptyRow>Loading…</EmptyRow>
          : filtered.length === 0 ? <EmptyRow>No referrals.</EmptyRow>
          : filtered.map((r) => {
            const st = s(r.status);
            const urg = s(r.urgency) || "ROUTINE";
            const specialist = specialistFromNotes(r.notes);
            const accent = urg === "EMERGENCY" ? "var(--clinical-coral)" : urg === "URGENT" ? "var(--clinical-amber)" : "var(--clinical-panel)";
            const linkedReqId = s(r.transportRequestId);
            const transportReq = linkedReqId ? transportById.get(linkedReqId) : undefined;
            const transportStatus = transportReq ? s(transportReq.status) : "";
            // Active transport requests block a duplicate; declined/cancelled re-open the button.
            const transportActive = !!transportReq && !["DECLINED", "CANCELLED"].includes(transportStatus);
            return (
              <div key={s(r.id)} className="rounded-2xl border p-4 transition hover:border-[var(--clinical-line-strong)] sm:p-5" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
                    <span className="inline-flex items-center gap-1.5 font-bold text-[var(--clinical-ink)]"><UserRound className="h-4 w-4 text-[var(--clinical-muted)]" />{rHeader(r)}</span>
                    <UrgencyBadge urgency={urg} />
                    <StatusBadge status={st} />
                    {transportActive && <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em]" style={{ backgroundColor: softTint("var(--clinical-panel)"), color: "var(--clinical-panel)" }}><Truck className="h-3 w-3" /> Transport</span>}
                  </div>
                  {s(r.scheduledDate) && <span className="rounded-lg bg-[var(--clinical-surface-2)] px-2.5 py-1 text-xs font-semibold text-[var(--clinical-muted)]">{fmtD(r.scheduledDate)}</span>}
                </div>

                <div className="grid grid-cols-1 gap-3 rounded-xl bg-[var(--clinical-surface-2)] p-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Detail label="Specialist" value={specialist || "—"} />
                  <Detail label="Clinic" value={s(r.facilityName) || "—"} />
                  <Detail label="Purpose" value={s(r.reason) || "—"} />
                  <Detail label={r.approvedByName ? "Approved By" : "Submitted By"} value={s(r.approvedByName) || s(r.referredByName) || rname(r)} />
                </div>

                {r.rejectionReason && (
                  <Banner tone="coral" icon={Ban}><span className="font-semibold">Rejected:</span> {s(r.rejectionReason)}</Banner>
                )}

                {r.outcome && (
                  <Banner tone="green" icon={Check}><span className="font-semibold">Outcome:</span> {s(r.outcome)}</Banner>
                )}

                {st === "REQUESTED" && (
                  <Banner tone="amber" icon={Info}>
                    Pending approval — nurse or care manager will approve/reject this in <b>Pending Approvals</b>, then confirm &amp; schedule here.
                  </Banner>
                )}

                {/* Transport — wired to Fleet Management as a driver-assignable request */}
                {transportActive && (
                  <Banner tone="teal" icon={Truck}>
                    <span className="font-semibold">{TRANSPORT_STATUS_LABEL[transportStatus] || `Transport: ${transportStatus}`}</span>
                    {transportStatus === "DECLINED" && transportReq && s(transportReq.declineReason) && <span className="text-[var(--clinical-coral)]"> — {s(transportReq.declineReason)}</span>}
                  </Banner>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {!transportActive && st !== "CANCELLED" && (
                    <ClinicalButton variant="secondary" size="sm" onClick={() => openRequest(r)} className="!min-h-9 !text-xs"><Truck className="h-3.5 w-3.5" /> Request Transport</ClinicalButton>
                  )}
                  {st === "APPROVED" && canApprove && (<>
                    <ClinicalButton variant="danger" size="sm" onClick={() => reject(r)} className="!min-h-9 !text-xs"><Ban className="h-3.5 w-3.5" /> Reject</ClinicalButton>
                    <ClinicalButton variant="primary" size="sm" onClick={() => schedule(r)} className="!min-h-9 !text-xs"><CalendarClock className="h-3.5 w-3.5" /> Confirm &amp; schedule</ClinicalButton>
                  </>)}
                  {st === "SCHEDULED" && (
                    <ClinicalButton size="sm" onClick={() => complete(r)} className="!min-h-9 !text-xs !text-white hover:brightness-110" style={{ backgroundColor: "var(--clinical-green)" }}><ClipboardCheck className="h-3.5 w-3.5" /> Document outcome</ClinicalButton>
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {/* New Referral / Appointment */}
      <ClinicalModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="New Referral / Appointment"
        description="Coordinate a specialist appointment or referral"
        size="lg"
        footer={<>
          <ClinicalButton variant="secondary" onClick={() => setShowAdd(false)} disabled={busy}>Cancel</ClinicalButton>
          <ClinicalButton onClick={submit} disabled={busy}><CalendarClock className="h-4 w-4" /> {busy ? "Scheduling…" : "Schedule Appointment"}</ClinicalButton>
        </>}
      >
        <div className="space-y-4">
          <div>
            <FieldLabel required>Resident</FieldLabel>
            <select value={form.residentId} onChange={(e) => setForm({ ...form, residentId: e.target.value })} className={controlClass}><option value="">Select resident…</option>{residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}</select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><FieldLabel required>Appointment Type</FieldLabel><select value={form.appointmentType} onChange={(e) => setForm({ ...form, appointmentType: e.target.value })} className={controlClass}>{APPOINTMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
            <div className="sm:col-span-2"><FieldLabel required>Date &amp; Time</FieldLabel><input type="datetime-local" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} className={controlClass} /></div>
            <div><FieldLabel>Specialist / Doctor Name</FieldLabel><input value={form.specialist} onChange={(e) => setForm({ ...form, specialist: e.target.value })} placeholder="e.g. Dr. Santos" className={controlClass} /></div>
            <div><FieldLabel>Clinic / Hospital</FieldLabel><input value={form.facilityName} onChange={(e) => setForm({ ...form, facilityName: e.target.value })} placeholder="e.g. St. Luke's Medical Center" className={controlClass} /></div>
            <div className="sm:col-span-2"><FieldLabel required>Referral Reason / Purpose</FieldLabel><textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2} placeholder="Reason for appointment or referral details…" className={controlClass} /></div>
            <div><FieldLabel>Documents Needed</FieldLabel><input value={form.documentsNeeded} onChange={(e) => setForm({ ...form, documentsNeeded: e.target.value })} placeholder="e.g. Lab results, referral letter, ID" className={controlClass} /></div>
            <div><FieldLabel>Companion / Escort Assigned</FieldLabel><input value={form.companion} onChange={(e) => setForm({ ...form, companion: e.target.value })} placeholder="e.g. Nurse Maria, Family member" className={controlClass} /></div>
            <div className="sm:col-span-2"><FieldLabel>Pre-Appointment Notes</FieldLabel><textarea value={form.preApptNotes} onChange={(e) => setForm({ ...form, preApptNotes: e.target.value })} rows={2} placeholder="Preparation instructions, fasting requirements, items to bring…" className={controlClass} /></div>
            <div><FieldLabel>Urgency</FieldLabel><select value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })} className={controlClass}>{["ROUTINE", "URGENT", "EMERGENCY"].map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
          </div>
          {/* Family Notified toggle — transport is arranged separately via the Request Transport action on each card. */}
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-3" style={{ backgroundColor: "var(--clinical-surface-2)", borderColor: "var(--clinical-line)" }}>
            <span className="flex items-center gap-3">
              <UserRound className="h-5 w-5 text-[var(--clinical-panel)]" />
              <span><span className="block text-sm font-semibold text-[var(--clinical-ink)]">Family Notified</span><span className="block text-xs text-[var(--clinical-muted)]">Send the family sponsor an approval request (auto-approves after 24h)</span></span>
            </span>
            <button type="button" role="switch" aria-checked={form.familyNotified} onClick={() => setForm({ ...form, familyNotified: !form.familyNotified })} className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${form.familyNotified ? "bg-[var(--clinical-panel)]" : "bg-[var(--clinical-line-strong)]"}`}>
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${form.familyNotified ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </label>
        </div>
      </ClinicalModal>

      {/* Request Transport */}
      <ClinicalModal
        open={!!reqFor}
        onClose={() => setReqFor(null)}
        title="Request Transport"
        description="Arrange a driver-assigned trip for this appointment"
        size="md"
        footer={<>
          <ClinicalButton variant="secondary" onClick={() => setReqFor(null)} disabled={reqBusy}>Cancel</ClinicalButton>
          <ClinicalButton onClick={submitRequest} disabled={reqBusy}><Truck className="h-4 w-4" /> {reqBusy ? "Sending…" : reqForm.driverId ? "Assign & schedule" : "Request transport"}</ClinicalButton>
        </>}
      >
        {reqFor && (
          <div className="space-y-4">
            <div className="rounded-lg px-3 py-2 text-sm text-[var(--clinical-ink)]" style={{ backgroundColor: "var(--clinical-surface-2)" }}><span className="font-semibold">{rname(reqFor)}</span>{s(reqFor.scheduledDate) && <> · {fmtD(reqFor.scheduledDate)}</>}</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><FieldLabel>Pickup</FieldLabel><input value={reqForm.pickupLocation} onChange={(e) => setReqForm({ ...reqForm, pickupLocation: e.target.value })} className={controlClass} /></div>
              <div><FieldLabel required>Destination</FieldLabel><input value={reqForm.destination} onChange={(e) => setReqForm({ ...reqForm, destination: e.target.value })} placeholder="Clinic / hospital" className={controlClass} /></div>
              <div className="sm:col-span-2"><FieldLabel required>Pickup date &amp; time</FieldLabel><input type="datetime-local" value={reqForm.requestedDate} onChange={(e) => setReqForm({ ...reqForm, requestedDate: e.target.value })} className={controlClass} /></div>
              <div><FieldLabel>Assign driver <span className="font-normal text-[var(--clinical-muted)]">(optional)</span></FieldLabel><select value={reqForm.driverId} onChange={(e) => setReqForm({ ...reqForm, driverId: e.target.value })} className={controlClass}><option value="">Leave to dispatch</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
              <div><FieldLabel required={!!reqForm.driverId}>Vehicle</FieldLabel><select value={reqForm.vehicleId} onChange={(e) => setReqForm({ ...reqForm, vehicleId: e.target.value })} disabled={!reqForm.driverId} className={`${controlClass} disabled:opacity-50`}><option value="">Select…</option>{vehicles.filter((v) => v.status !== "MAINTENANCE").map((v) => <option key={v.id} value={v.id}>{v.name}{v.plate ? ` (${v.plate})` : ""}</option>)}</select></div>
            </div>
            <p className="text-xs text-[var(--clinical-muted)]">Creates a Fleet transport request. Leave the driver unassigned to send it to dispatch, or assign a driver &amp; vehicle now to schedule the trip directly.</p>
          </div>
        )}
      </ClinicalModal>

      {/* Document outcome */}
      <ClinicalModal
        open={!!outcomeFor}
        onClose={() => setOutcomeFor(null)}
        title="Document outcome"
        description="Record what happened at the appointment and mark it completed"
        size="md"
        footer={<>
          <ClinicalButton variant="secondary" onClick={() => setOutcomeFor(null)} disabled={outcomeBusy}>Cancel</ClinicalButton>
          <ClinicalButton onClick={submitOutcome} disabled={outcomeBusy} className="!text-white hover:brightness-110" style={{ backgroundColor: "var(--clinical-green)" }}><ClipboardCheck className="h-4 w-4" /> {outcomeBusy ? "Saving…" : "Complete appointment"}</ClinicalButton>
        </>}
      >
        {outcomeFor && (
          <div className="space-y-4">
            {/* Appointment context so the clinician knows exactly what they're closing out */}
            <div className="rounded-xl border p-3" style={{ backgroundColor: "var(--clinical-surface-2)", borderColor: "var(--clinical-line)" }}>
              <div className="flex items-center gap-2 font-semibold text-[var(--clinical-ink)]"><UserRound className="h-4 w-4 text-[var(--clinical-muted)]" />{rHeader(outcomeFor)}</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div><p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">Specialist</p><p className="mt-0.5 text-sm text-[var(--clinical-ink)]">{specialistFromNotes(outcomeFor.notes) || "—"}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">Appointment date</p><p className="mt-0.5 text-sm text-[var(--clinical-ink)]">{fmtD(outcomeFor.scheduledDate)}</p></div>
              </div>
            </div>

            <div><FieldLabel>Result</FieldLabel><select value={outcomeForm.result} onChange={(e) => setOutcomeForm({ ...outcomeForm, result: e.target.value })} className={controlClass}>{OUTCOME_RESULTS.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>

            <div>
              <FieldLabel required>Findings, follow-up &amp; notes</FieldLabel>
              <textarea value={outcomeForm.findings} onChange={(e) => setOutcomeForm({ ...outcomeForm, findings: e.target.value })} rows={5} placeholder="What did the specialist find? Diagnosis, treatment given, medications changed, instructions for the care team…" className={controlClass} />
            </div>

            {/* Follow-up — reveals a date only when needed, so the form stays light */}
            <div className="rounded-xl border" style={{ borderColor: "var(--clinical-line)" }}>
              <label className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
                <span className="flex items-center gap-3">
                  <CalendarClock className="h-5 w-5 text-[var(--clinical-panel)]" />
                  <span><span className="block text-sm font-semibold text-[var(--clinical-ink)]">Follow-up required</span><span className="block text-xs text-[var(--clinical-muted)]">Flag that another appointment is needed</span></span>
                </span>
                <button type="button" role="switch" aria-checked={outcomeForm.followUp} onClick={() => setOutcomeForm({ ...outcomeForm, followUp: !outcomeForm.followUp })} className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${outcomeForm.followUp ? "bg-[var(--clinical-panel)]" : "bg-[var(--clinical-line-strong)]"}`}>
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${outcomeForm.followUp ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
              </label>
              {outcomeForm.followUp && (
                <div className="border-t px-4 py-3" style={{ borderColor: "var(--clinical-line)" }}>
                  <FieldLabel>Follow-up by <span className="font-normal text-[var(--clinical-muted)]">(optional)</span></FieldLabel>
                  <input type="date" value={outcomeForm.followUpDate} onChange={(e) => setOutcomeForm({ ...outcomeForm, followUpDate: e.target.value })} className={controlClass} />
                </div>
              )}
            </div>
          </div>
        )}
      </ClinicalModal>

      {/* Reject referral */}
      <ClinicalModal
        open={!!rejectFor}
        onClose={() => setRejectFor(null)}
        title="Reject referral"
        description="Decline this referral and let the requester know why"
        size="md"
        footer={<>
          <ClinicalButton variant="secondary" onClick={() => setRejectFor(null)} disabled={rejectBusy}>Cancel</ClinicalButton>
          <ClinicalButton variant="danger" onClick={submitReject} disabled={rejectBusy}><Ban className="h-4 w-4" /> {rejectBusy ? "Rejecting…" : "Reject referral"}</ClinicalButton>
        </>}
      >
        {rejectFor && (
          <div className="space-y-4">
            <div className="rounded-xl border p-3" style={{ backgroundColor: "var(--clinical-surface-2)", borderColor: "var(--clinical-line)" }}>
              <div className="flex items-center gap-2 font-semibold text-[var(--clinical-ink)]"><UserRound className="h-4 w-4 text-[var(--clinical-muted)]" />{rHeader(rejectFor)}</div>
              <p className="mt-1 text-xs text-[var(--clinical-muted)]">{specialistFromNotes(rejectFor.notes) || "—"} · {s(rejectFor.facilityName) || "—"}</p>
            </div>
            <div>
              <FieldLabel>Reason for rejection</FieldLabel>
              <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={4} autoFocus placeholder="Why is this referral being declined? (shared with the requester and family)" className={controlClass} />
            </div>
          </div>
        )}
      </ClinicalModal>

      {/* Confirm & schedule */}
      <ClinicalModal
        open={!!schedFor}
        onClose={() => setSchedFor(null)}
        title="Confirm & schedule"
        description="Lock in the confirmed appointment date and time"
        size="md"
        footer={<>
          <ClinicalButton variant="secondary" onClick={() => setSchedFor(null)} disabled={schedBusy}>Cancel</ClinicalButton>
          <ClinicalButton onClick={submitSchedule} disabled={schedBusy}><CalendarClock className="h-4 w-4" /> {schedBusy ? "Scheduling…" : "Confirm & schedule"}</ClinicalButton>
        </>}
      >
        {schedFor && (
          <div className="space-y-4">
            <div className="rounded-xl border p-3" style={{ backgroundColor: "var(--clinical-surface-2)", borderColor: "var(--clinical-line)" }}>
              <div className="flex items-center gap-2 font-semibold text-[var(--clinical-ink)]"><UserRound className="h-4 w-4 text-[var(--clinical-muted)]" />{rHeader(schedFor)}</div>
              <p className="mt-1 text-xs text-[var(--clinical-muted)]">{specialistFromNotes(schedFor.notes) || "—"} · {s(schedFor.facilityName) || "—"}</p>
            </div>
            <div>
              <FieldLabel required>Appointment date &amp; time</FieldLabel>
              <input type="datetime-local" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} className={controlClass} />
            </div>
            <p className="text-xs text-[var(--clinical-muted)]">Scheduling marks the referral confirmed and lists it on the Appointment Calendar.</p>
          </div>
        )}
      </ClinicalModal>
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border p-8 text-center text-sm text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>{children}</div>;
}

function Stat({ label, value, accent, icon: Icon }: { label: string; value: string; accent: string; icon: typeof Truck }) {
  return (
    <div className="rounded-2xl border p-4 sm:p-5" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--clinical-muted)]">{label}</span>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: softTint(accent), color: accent }}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-3 text-3xl font-bold leading-none tabular-nums" style={{ color: accent }}>{value}</p>
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

// Soft-tinted inline notice — one shape for every banner (rejected / outcome /
// pending / transport), coloured from a single token so they harmonise.
function Banner({ tone, icon: Icon, children }: { tone: "amber" | "green" | "coral" | "teal"; icon: typeof Truck; children: React.ReactNode }) {
  const c = { amber: "var(--clinical-amber)", green: "var(--clinical-green)", coral: "var(--clinical-coral)", teal: "var(--clinical-panel)" }[tone];
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm text-[var(--clinical-ink)]" style={{ backgroundColor: softTint(c), borderColor: `color-mix(in srgb, ${c} 30%, transparent)` }}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: c }} />
      <span>{children}</span>
    </div>
  );
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const c = urgency === "EMERGENCY" ? "var(--clinical-coral)" : urgency === "URGENT" ? "var(--clinical-amber)" : "var(--clinical-muted)";
  return <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em]" style={{ backgroundColor: softTint(c), color: c }}>{urgency}</span>;
}

// Status → one pill. Solid fill signals a settled state; APPROVED (a brief gate
// step) reads as a soft indigo tint so it stays distinct from SCHEDULED.
function StatusBadge({ status }: { status: string }) {
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  const MAP: Record<string, [string, boolean]> = {
    REQUESTED: ["var(--clinical-amber)", true],
    APPROVED: ["var(--clinical-panel)", false],
    SCHEDULED: ["var(--clinical-panel)", true],
    COMPLETED: ["var(--clinical-green)", true],
    CANCELLED: ["var(--clinical-coral)", true],
  };
  const [c, solid] = MAP[status] ?? ["var(--clinical-muted)", false];
  const style = solid ? { backgroundColor: c, color: "#fff" } : { backgroundColor: softTint(c), color: c };
  return <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em]" style={style}>{label}</span>;
}
