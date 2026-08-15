"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Phone, Plus, Printer, Search, Check, Video, FileText, User, Link2,
  Clock, CheckCircle2, AlertTriangle, MessageSquareText, Eye, Loader2, UserRound,
  type LucideIcon,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord } from "@/lib/api";
import { ClinicalHeader, ClinicalCard, ClinicalButton, StatusPill, MicroLabel, Eyebrow, ClinicalModal, FieldLabel, controlClass, Skeleton } from "./clinical-ui";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const rel = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});
const fmt = (v: unknown) => (v ? new Date(s(v)).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

const METHODS = ["PHONE", "IN_PERSON", "WRITTEN", "TELEMEDICINE"] as const;
const METHOD_META: Record<string, { icon: LucideIcon; label: string; color: string }> = {
  PHONE: { icon: Phone, label: "Phone Call", color: "#2E4A48" },
  IN_PERSON: { icon: User, label: "In-Person Visit", color: "#C0573F" },
  WRITTEN: { icon: FileText, label: "Written", color: "#C39A3E" },
  TELEMEDICINE: { icon: Video, label: "Telemedicine", color: "#5B7A70" },
};
const DEFAULT_META = { icon: Phone, label: "Phone Call", color: "#2E4A48" };

type StatusKey = "all" | "open" | "overdue" | "done";
const STATUS_TABS: { key: StatusKey; label: string }[] = [
  { key: "all", label: "All contacts" },
  { key: "open", label: "Follow-up required" },
  { key: "overdue", label: "Overdue" },
  { key: "done", label: "Completed" },
];

/** Physician Communication Log (Module 11) — clinical-editorial style (PDF-matched). */
export default function PhysicianCommsLog() {
  const { data: rows, loading, refetch } = useLiveQuery<Row>("physician-communications", { query: "include=resident&take=400", tables: ["PhysicianCommunication"] });
  const { data: residentRows } = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });
  const residents = useMemo(() => residentRows.map(adaptResident), [residentRows]);

  // Escalations, for the SBAR link — a physician communication can be the direct
  // result of an SBAR escalation, giving one record with the full clinical context.
  const { data: escRows } = useLiveQuery<Row>("escalations", { query: "include=resident&take=400", tables: ["Escalation"] });
  const escMap = useMemo(() => new Map(escRows.map((e) => [s(e.id), e])), [escRows]);
  const escSnippet = (e: Row) => { const t = s(e.situation).trim(); return t.length > 52 ? `${t.slice(0, 52)}…` : t || "SBAR escalation"; };

  const [session, setSession] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
  useEffect(() => { fetch("/api/auth/session").then((r) => r.json()).then((d) => { if (d?.authenticated) setSession({ id: d.session?.userId ?? null, name: d.session?.name ?? "Clinician" }); }).catch(() => {}); }, []);

  const [search, setSearch] = useState("");
  const [resFilter, setResFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusKey>("all");
  const [nowMs] = useState(() => Date.now());
  const [showAdd, setShowAdd] = useState(false);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({ residentId: "", method: "PHONE", physicianName: "", reason: "", instructionsReceived: "", followUpRequired: false, followUpDeadline: "", relatedEscalationId: "" });

  // Escalations for the resident chosen in the modal (newest first) — the SBAR picker.
  const residentEscalations = useMemo(
    () => escRows.filter((e) => s(e.residentId) === form.residentId).sort((a, b) => new Date(s(b.createdAt)).getTime() - new Date(s(a.createdAt)).getTime()),
    [escRows, form.residentId]
  );

  const rname = (c: Row) => { const r = rel(c.resident); return `${s(r.firstName)} ${s(r.lastName)}`.trim() || "—"; };
  const rroom = (c: Row) => s(rel(c.resident).roomNumber) || "—";
  const isOverdue = useCallback((c: Row) => Boolean(c.followUpRequired && !c.followUpCompletedAt && c.followUpDeadline && new Date(s(c.followUpDeadline)).getTime() < nowMs), [nowMs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (resFilter && s(c.residentId) !== resFilter) return false;
      if (q && !rname(c).toLowerCase().includes(q) && !s(c.physicianName).toLowerCase().includes(q) && !s(c.reason).toLowerCase().includes(q)) return false;
      if (statusFilter === "open" && !(c.followUpRequired && !c.followUpCompletedAt)) return false;
      if (statusFilter === "overdue" && !isOverdue(c)) return false;
      if (statusFilter === "done" && !c.followUpCompletedAt) return false;
      return true;
    });
  }, [rows, search, resFilter, statusFilter, isOverdue]);

  const overdueCount = rows.filter(isOverdue).length;
  const openCount = rows.filter((c) => c.followUpRequired && !c.followUpCompletedAt).length;
  const doneCount = rows.filter((c) => c.followUpCompletedAt).length;
  const linkedCount = rows.filter((c) => c.relatedEscalationId).length;
  const hasFilters = search !== "" || resFilter !== "" || statusFilter !== "all";
  const clearFilters = () => { setSearch(""); setResFilter(""); setStatusFilter("all"); };

  const submit = async () => {
    if (!form.residentId || !form.physicianName.trim() || !form.reason.trim() || !form.instructionsReceived.trim()) { Swal.fire("Missing fields", "Resident, physician, reason, and instructions received are required.", "warning"); return; }
    setBusy(true);
    try {
      await createRecord("physician-communications", {
        residentId: form.residentId, method: form.method, physicianName: form.physicianName.trim(),
        reason: form.reason.trim(), instructionsReceived: form.instructionsReceived.trim(),
        loggedById: session.id, loggedByName: session.name, followUpRequired: form.followUpRequired,
        followUpDeadline: form.followUpRequired && form.followUpDeadline ? new Date(form.followUpDeadline).toISOString() : null,
        relatedEscalationId: form.relatedEscalationId || null,
        occurredAt: new Date().toISOString(),
      });
      await refetch(); setShowAdd(false);
      setForm({ residentId: "", method: "PHONE", physicianName: "", reason: "", instructionsReceived: "", followUpRequired: false, followUpDeadline: "", relatedEscalationId: "" });
      Swal.fire({ title: "Logged", text: "Physician communication recorded.", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not save.", "error"); } finally { setBusy(false); }
  };
  const completeFollowUp = async (c: Row) => {
    setBusyId(s(c.id));
    try {
      const completedAt = new Date().toISOString();
      await updateRecord("physician-communications", s(c.id), { followUpCompletedAt: completedAt });
      await refetch();
      setViewing((v) => (v && s(v.id) === s(c.id) ? { ...v, followUpCompletedAt: completedAt } : v));
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not update.", "error"); } finally { setBusyId(null); }
  };

  // Print a single contact as a clean standalone document.
  const printRecord = (c: Row) => {
    const esc = (v: unknown) => s(v).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch] as string));
    const linked = c.relatedEscalationId ? escMap.get(s(c.relatedEscalationId)) : undefined;
    const meta = METHOD_META[s(c.method)] ?? DEFAULT_META;
    const row = (l: string, v: unknown) => (v ? `<div class="row"><div class="l">${l}</div><div class="v">${esc(v)}</div></div>` : "");
    const w = window.open("", "_blank", "width=720,height=860");
    if (!w) return;
    const fu = c.followUpRequired
      ? c.followUpCompletedAt
        ? `Completed ${new Date(s(c.followUpCompletedAt)).toLocaleString()}`
        : `Required by ${c.followUpDeadline ? new Date(s(c.followUpDeadline)).toLocaleString() : "—"}${isOverdue(c) ? " (OVERDUE)" : ""}`
      : "";
    w.document.write(`<html><head><title>Physician Contact — ${esc(s(c.physicianName))}</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:36px;color:#111;line-height:1.5}h1{font-size:20px;margin:0 0 4px}.meta{color:#555;font-size:13px;margin-bottom:18px}.row{margin:12px 0}.l{font-weight:700;color:#b91c1c;font-size:13px;text-transform:uppercase;letter-spacing:.04em}.v{white-space:pre-wrap;margin-top:2px}</style></head><body><h1>Physician Communication — ${esc(s(c.physicianName))} (${esc(meta.label)})</h1><div class="meta">${esc(rname(c))} · Room ${esc(rroom(c))} · ${c.occurredAt ? new Date(s(c.occurredAt)).toLocaleString() : "—"} · Logged by ${esc(s(c.loggedByName) || "—")}</div>${row("Reason for contact", s(c.reason))}${row("Instructions received (verbatim)", s(c.instructionsReceived))}${linked ? row("Linked SBAR — Situation", s(linked.situation)) + row("Linked SBAR — Recommendation", s(linked.recommendation)) + (linked.response ? row("Physician response", s(linked.response)) : "") : ""}${row("Follow-up", fu)}</body></html>`);
    w.document.close(); w.focus(); w.print();
  };

  return (
    <div className="-m-4 min-h-full space-y-5 bg-[var(--clinical-ground)] p-4 sm:-m-6 sm:p-6 print:m-0 print:bg-white print:p-0">
      <div className="print:hidden">
        <ClinicalHeader
          title="Physician Communications"
          subtitle="Every physician contact on record — with instructions received verbatim, SBAR-linked context, and follow-up tracking."
          right={
            <div className="flex flex-wrap items-center gap-2">
              <span className="hidden items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] text-[var(--clinical-green)] md:inline-flex" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--clinical-green)]" /> Live
              </span>
              <ClinicalButton variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</ClinicalButton>
              <ClinicalButton onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> Log Contact</ClinicalButton>
            </div>
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-[var(--clinical-line)] lg:grid-cols-4 print:hidden" style={{ borderColor: "var(--clinical-line)" }}>
        <Stat label="Contacts on record" value={rows.length} icon={MessageSquareText} color="var(--clinical-ink)" />
        <Stat label="Open follow-ups" value={openCount} icon={Clock} color="var(--clinical-amber)" />
        <Stat label="Overdue" value={overdueCount} icon={AlertTriangle} color="var(--clinical-coral)" />
        <Stat label="Linked SBAR" value={linkedCount} icon={Link2} color="var(--clinical-panel)" />
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border p-3 print:hidden" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="inline-flex items-center self-start overflow-x-auto rounded-xl bg-[var(--clinical-surface-2)] p-1">
            {STATUS_TABS.map((t) => (
              <button key={t.key} onClick={() => setStatusFilter(t.key)}
                className={`min-h-9 shrink-0 rounded-lg px-3.5 text-xs font-semibold transition focus:outline-none ${statusFilter === t.key ? "bg-[var(--clinical-panel)] text-white shadow-sm" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--clinical-muted)]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resident, physician, or reason…" aria-label="Search contacts" className="min-h-11 w-full rounded-xl border bg-[var(--clinical-surface)] py-2.5 pl-10 pr-4 text-sm text-[var(--clinical-ink)] outline-none transition focus:border-[var(--clinical-focus)] focus:ring-2 focus:ring-[var(--clinical-focus)]/20" style={{ borderColor: "var(--clinical-line)" }} />
          </div>
          <select value={resFilter} onChange={(e) => setResFilter(e.target.value)} className="min-h-11 rounded-xl border bg-[var(--clinical-surface)] px-3 py-2 text-sm text-[var(--clinical-ink)] outline-none focus:border-[var(--clinical-focus)] focus:ring-2 focus:ring-[var(--clinical-focus)]/20" style={{ borderColor: "var(--clinical-line)" }}>
            <option value="">All residents</option>
            {residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Rm {r.room}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--clinical-muted)]">
          <span>Showing {filtered.length} of {rows.length} contacts</span>
          {overdueCount > 0 && <StatusPill status="OVERDUE" className="!text-[10px]">{`${overdueCount} follow-up${overdueCount === 1 ? "" : "s"} overdue`}</StatusPill>}
          {doneCount > 0 && statusFilter === "done" && <span className="text-[var(--clinical-green)]">{doneCount} completed</span>}
          {hasFilters && <button onClick={clearFilters} className="font-semibold text-[var(--clinical-panel)] hover:underline">Clear filters</button>}
        </div>
      </div>

      <Eyebrow className="print:block">Log Entries</Eyebrow>

      {loading && filtered.length === 0 ? (
        <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border p-10 text-center" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
          <MessageSquareText className="mx-auto h-10 w-10 opacity-30" style={{ color: "var(--clinical-muted)" }} />
          <p className="mt-3 text-sm font-semibold text-[var(--clinical-ink)]">{hasFilters ? "No contacts match your filters" : "No physician communications logged."}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--clinical-muted)]">{hasFilters ? "Try adjusting the search or filter tabs above." : "Use “Log Contact” to record the first physician interaction."}</p>
          {hasFilters && <ClinicalButton variant="secondary" size="sm" className="mt-4" onClick={clearFilters}>Clear filters</ClinicalButton>}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((c) => {
            const meta = METHOD_META[s(c.method)] ?? DEFAULT_META;
            const overdue = isOverdue(c);
            const linked = c.relatedEscalationId ? escMap.get(s(c.relatedEscalationId)) : undefined;
            const busy = busyId === s(c.id);
            return (
              <ClinicalCard key={s(c.id)} className="break-inside-avoid overflow-hidden">
                <div className="h-1 w-full" style={{ backgroundColor: meta.color }} />
                <div className="p-4 sm:p-5">
                  <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white" style={{ backgroundColor: meta.color }}><meta.icon className="h-5 w-5" /></span>
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-bold text-[var(--clinical-ink)]">{s(c.physicianName)}</p>
                        <p className="text-xs text-[var(--clinical-muted)]">{meta.label} · {fmt(c.occurredAt)}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {overdue && <StatusPill status="OVERDUE" className="!text-[10px]" />}
                      {!overdue && c.followUpRequired && !c.followUpCompletedAt && <StatusPill status="FOLLOW_UP" className="!text-[10px]" />}
                      <button onClick={() => setViewing(c)} aria-label="View details" className="rounded-lg p-2 text-[var(--clinical-muted)] transition hover:bg-[var(--clinical-surface-2)] hover:text-[var(--clinical-ink)] print:hidden"><Eye className="h-4 w-4" /></button>
                    </div>
                  </div>

                  <p className="mb-3.5 flex flex-wrap items-center gap-1.5 text-[13px] text-[var(--clinical-muted)]">
                    <UserRound className="h-3.5 w-3.5" />
                    <span className="font-medium text-[#2B2B27]">{rname(c)}</span> · Room {rroom(c)}
                    {c.loggedByName ? <span className="text-xs">· Logged by {s(c.loggedByName)}</span> : null}
                  </p>

                  <div className="space-y-2.5">
                    <DetailBlock label="Reason for contact" tone="coral">{s(c.reason)}</DetailBlock>
                    <DetailBlock label="Instructions received (verbatim)" tone="teal">{s(c.instructionsReceived)}</DetailBlock>
                  </div>

                  {linked && (
                    <button onClick={() => setViewing(c)} className="mt-3 block w-full rounded-xl border border-[#2E4A48]/15 bg-[#2E4A48]/[0.04] p-3.5 text-left transition hover:bg-[#2E4A48]/[0.08]">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#2E4A48]"><Link2 className="h-3.5 w-3.5 text-[#C0573F]" /> Linked SBAR</span>
                        {linked.priority ? <StatusPill status={s(linked.priority)} /> : null}
                      </div>
                      <p className="text-sm text-[#2B2B27]"><span className="font-semibold text-[#6B6E63]">S:</span> {s(linked.situation) || "—"}</p>
                      {linked.recommendation ? <p className="mt-0.5 text-[13px] text-[#6B6E63]"><span className="font-semibold">R:</span> {s(linked.recommendation)}</p> : null}
                      {linked.response ? <p className="mt-0.5 text-[13px] text-[#6B6E63]"><span className="font-semibold">Response:</span> {s(linked.response)}</p> : null}
                    </button>
                  )}

                  <FollowUpRow c={c} overdue={overdue} busy={busy} onComplete={() => completeFollowUp(c)} />
                </div>
              </ClinicalCard>
            );
          })}
        </div>
      )}

      {/* Log Physician Contact */}
      <ClinicalModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Log Physician Contact"
        description="Record the interaction and any instructions received verbatim."
        size="lg"
        footer={
          <>
            <ClinicalButton variant="secondary" onClick={() => setShowAdd(false)} disabled={busy}>Cancel</ClinicalButton>
            <ClinicalButton onClick={() => void submit()} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{busy ? "Saving…" : "Save Contact"}</ClinicalButton>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <FieldLabel required>Resident</FieldLabel>
            <select value={form.residentId} onChange={(e) => setForm({ ...form, residentId: e.target.value, relatedEscalationId: "" })} className={controlClass}>
              <option value="">Select resident…</option>
              {residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Method</FieldLabel>
              <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className={controlClass}>
                {METHODS.map((m) => <option key={m} value={m}>{METHOD_META[m].label}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel required>Physician</FieldLabel>
              <input value={form.physicianName} onChange={(e) => setForm({ ...form, physicianName: e.target.value })} placeholder="Dr. …" className={controlClass} />
            </div>
          </div>
          <div>
            <FieldLabel required>Reason for contact</FieldLabel>
            <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. SpO₂ dropped to 88% with increased work of breathing" className={controlClass} />
          </div>
          <div>
            <FieldLabel required>Instructions received (verbatim)</FieldLabel>
            <textarea value={form.instructionsReceived} onChange={(e) => setForm({ ...form, instructionsReceived: e.target.value })} rows={3} placeholder="Record exactly what the physician instructed…" className={`${controlClass} resize-y`} />
          </div>
          <div>
            <FieldLabel><span className="inline-flex items-center gap-1"><Link2 className="h-3.5 w-3.5 text-[#C0573F]" /> Link to SBAR escalation (optional)</span></FieldLabel>
            <select value={form.relatedEscalationId} onChange={(e) => setForm({ ...form, relatedEscalationId: e.target.value })} disabled={!form.residentId} className={`${controlClass} disabled:opacity-50`}>
              <option value="">{form.residentId ? (residentEscalations.length ? "None" : "No escalations for this resident") : "Select a resident first…"}</option>
              {residentEscalations.map((e) => <option key={s(e.id)} value={s(e.id)}>{s(e.priority) || "SBAR"} · {escSnippet(e)} · {fmt(e.createdAt)}</option>)}
            </select>
            <p className="mt-1.5 text-[11px] text-[var(--clinical-muted)]">Ties this contact to the escalation it resulted from — one record for the full clinical context.</p>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input id="fu" type="checkbox" checked={form.followUpRequired} onChange={(e) => setForm({ ...form, followUpRequired: e.target.checked })} className="h-4 w-4 rounded accent-[var(--clinical-panel)]" />
            <span className="text-sm font-semibold text-[var(--clinical-ink)]">Follow-up required</span>
          </label>
          {form.followUpRequired && (
            <div>
              <FieldLabel>Follow-up deadline</FieldLabel>
              <input type="datetime-local" value={form.followUpDeadline} onChange={(e) => setForm({ ...form, followUpDeadline: e.target.value })} className={controlClass} />
            </div>
          )}
        </div>
      </ClinicalModal>

      {/* Detail view */}
      <ClinicalModal
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title={viewing ? `${s(viewing.physicianName)} · ${rname(viewing)}` : ""}
        size="lg"
        footer={
          viewing ? (
            <>
              <ClinicalButton variant="secondary" onClick={() => printRecord(viewing)}><Printer className="h-4 w-4" /> Print</ClinicalButton>
              {viewing.followUpRequired && !viewing.followUpCompletedAt && (
                <ClinicalButton onClick={() => completeFollowUp(viewing)} disabled={busyId === s(viewing.id)}>
                  {busyId === s(viewing.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Mark Follow-up Complete
                </ClinicalButton>
              )}
            </>
          ) : null
        }
      >
        {viewing && (() => {
          const c = viewing;
          const meta = METHOD_META[s(c.method)] ?? DEFAULT_META;
          const overdue = isOverdue(c);
          const linked = c.relatedEscalationId ? escMap.get(s(c.relatedEscalationId)) : undefined;
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4" style={{ backgroundColor: "var(--clinical-surface-2)", borderColor: "var(--clinical-line)" }}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white" style={{ backgroundColor: meta.color }}><meta.icon className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-bold text-[var(--clinical-ink)]">{s(c.physicianName)}</p>
                    <p className="text-xs text-[var(--clinical-muted)]">{meta.label} · {fmt(c.occurredAt)}</p>
                  </div>
                </div>
                {linked && linked.priority ? <StatusPill status={s(linked.priority)} /> : null}
              </div>

              <p className="flex flex-wrap items-center gap-1.5 text-sm text-[var(--clinical-muted)]">
                <UserRound className="h-4 w-4" />
                <span className="font-semibold text-[var(--clinical-ink)]">{rname(c)}</span> · Room {rroom(c)}
                {c.loggedByName ? <span className="text-xs">· Logged by {s(c.loggedByName)}</span> : null}
              </p>

              <DetailBlock label="Reason for contact" tone="coral">{s(c.reason)}</DetailBlock>
              <DetailBlock label="Instructions received (verbatim)" tone="teal">{s(c.instructionsReceived)}</DetailBlock>

              {linked && (
                <div className="rounded-xl border border-[#2E4A48]/15 bg-[#2E4A48]/[0.04] p-4">
                  <div className="mb-2.5 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#2E4A48]"><Link2 className="h-3.5 w-3.5 text-[#C0573F]" /> Linked SBAR Escalation</span>
                    {linked.priority ? <StatusPill status={s(linked.priority)} /> : null}
                    {linked.status ? <StatusPill status={s(linked.status)} /> : null}
                  </div>
                  <div className="divide-y divide-[#2E4A48]/10">
                    <SbarLine letter="S" label="Situation" value={s(linked.situation)} />
                    {linked.background ? <SbarLine letter="B" label="Background" value={s(linked.background)} /> : null}
                    {linked.assessment ? <SbarLine letter="A" label="Assessment" value={s(linked.assessment)} /> : null}
                    {linked.recommendation ? <SbarLine letter="R" label="Recommendation" value={s(linked.recommendation)} coral /> : null}
                  </div>
                  {linked.response ? (
                    <div className="mt-3 rounded-lg border border-[#7E9B6F]/40 bg-[#7E9B6F]/[0.1] p-3">
                      <MicroLabel className="!text-[#5E7A50]">Physician response</MicroLabel>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-[#2B2B27]">{s(linked.response)}</p>
                    </div>
                  ) : null}
                </div>
              )}

              <FollowUpRow c={c} overdue={overdue} busy={busyId === s(c.id)} onComplete={() => completeFollowUp(c)} />
            </div>
          );
        })()}
      </ClinicalModal>
    </div>
  );
}

/* ── Presentational pieces ── */

function Stat({ label, value, icon: Icon, color }: { label: string; value: number; icon: LucideIcon; color: string }) {
  return (
    <div className="bg-[var(--clinical-surface)] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--clinical-muted)] sm:text-[11px]">{label}</span>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--clinical-surface-2)]"><Icon className="h-4 w-4" style={{ color }} /></span>
      </div>
      <p className="mt-2 text-2xl font-bold leading-none tabular-nums sm:text-3xl" style={{ color }}>{value}</p>
    </div>
  );
}

function DetailBlock({ label, tone, children }: { label: string; tone: "coral" | "teal"; children: ReactNode }) {
  return (
    <div className="rounded-xl border p-3.5" style={{ backgroundColor: "var(--clinical-surface-2)", borderColor: "var(--clinical-line)", borderLeft: `3px solid ${tone === "coral" ? "#C0573F" : "#2E4A48"}` }}>
      <MicroLabel className={tone === "coral" ? "!text-[#C0573F]" : "!text-[#2E4A48]"}>{label}</MicroLabel>
      <p className="mt-1 whitespace-pre-wrap text-sm text-[#2B2B27]">{children}</p>
    </div>
  );
}

function SbarLine({ letter, label, value, coral }: { letter: string; label: string; value: string; coral?: boolean }) {
  return (
    <div className="py-2.5">
      <div className="flex gap-3">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold text-white ${coral ? "bg-[#C0573F]" : "bg-[#2E4A48]"}`} style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>{letter}</span>
        <div className="min-w-0">
          <MicroLabel className={coral ? "!text-[#C0573F]" : ""}>{label}</MicroLabel>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-[#2B2B27]">{value}</p>
        </div>
      </div>
    </div>
  );
}

function FollowUpRow({ c, overdue, busy, onComplete }: { c: Row; overdue: boolean; busy?: boolean; onComplete: () => void }) {
  if (!c.followUpRequired) return null;
  if (c.followUpCompletedAt) {
    return (
      <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-[#7E9B6F]/30 bg-[#7E9B6F]/[0.08] px-3.5 py-2.5">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-[#7E9B6F]" />
        <p className="text-sm text-[#5E7A50]"><span className="font-semibold">Follow-up completed</span> <span className="text-xs">{fmt(c.followUpCompletedAt)}</span></p>
      </div>
    );
  }
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-3" style={{ borderColor: overdue ? "rgba(192,87,63,0.45)" : "rgba(126,155,111,0.45)", backgroundColor: overdue ? "rgba(192,87,63,0.05)" : "rgba(126,155,111,0.06)" }}>
      <div className="flex min-w-0 items-center gap-2.5">
        {overdue ? <AlertTriangle className="h-4 w-4 shrink-0 text-[#C0573F]" /> : <Clock className="h-4 w-4 shrink-0 text-[#7E9B6F]" />}
        <div className="min-w-0">
          <p className={`text-xs font-bold uppercase tracking-[0.06em] ${overdue ? "text-[#C0573F]" : "text-[#5E7A50]"}`}>{overdue ? "Overdue" : "Follow-up required"}</p>
          <p className="text-xs text-[var(--clinical-muted)]">Deadline: {fmt(c.followUpDeadline)}</p>
        </div>
      </div>
      <button onClick={onComplete} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[#7E9B6F] px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-105 disabled:opacity-50 print:hidden">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Mark complete
      </button>
    </div>
  );
}
