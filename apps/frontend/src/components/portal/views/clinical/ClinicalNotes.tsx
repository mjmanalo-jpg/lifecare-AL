"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import {
  PenTool, Search, X, Plus, RefreshCw, FileText, Clock, Trash2,
  Mic, MicOff, Sparkles, Loader2, ChevronLeft, ChevronRight, Eye, type LucideIcon,
} from "lucide-react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, deleteRecord } from "@/lib/api";
import { useClinician, type ClinicianRole } from "./useClinician";

/**
 * Shared clinical notes module for the Physician & Head Nurse portals (Phase:
 * clinical portals). Live via Supabase realtime + polling on the MedicalNote
 * model. Adds Voice-to-Text dictation (browser Web Speech API) and an
 * AI-Generated Draft (grounded /api/ai-assistant scribe → structured local
 * fallback). Author attribution is role-aware. No static data, no localStorage.
 */

interface NoteVM {
  id: string; title: string; content: string; noteType: string;
  authorName: string; residentId: string; residentName: string;
  room: string; createdAt: string | null;
}

const NOTE_TYPES = [
  { value: "CLINICAL_NOTE", label: "Clinical Note" },
  { value: "SOAP_NOTE", label: "SOAP Note" },
  { value: "PROGRESS_NOTE", label: "Progress Note" },
  { value: "DISCHARGE_SUMMARY", label: "Discharge Summary" },
  { value: "CONSULTATION", label: "Consultation" },
  { value: "ORDER_NOTE", label: "Order Note" },
];

const TYPE_BADGE: Record<string, string> = {
  CLINICAL_NOTE: "bg-blue-100 text-blue-700",
  SOAP_NOTE: "bg-green-100 text-green-700",
  PROGRESS_NOTE: "bg-purple-100 text-purple-700",
  DISCHARGE_SUMMARY: "bg-orange-100 text-orange-700",
  CONSULTATION: "bg-teal-100 text-teal-700",
  ORDER_NOTE: "bg-gray-100 text-gray-700",
};

const asStr = (v: unknown): string => (v == null ? "" : String(v));

function relTime(iso: string | null, nowTs: number): string {
  if (!iso || !nowTs) return "—";
  const m = Math.round((nowTs - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function ClinicalNotes({ clinicianRole = "PHYSICIAN" }: { clinicianRole?: ClinicianRole }) {
  const { data: noteRows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>(
    "medical-notes", { query: "take=500", tables: ["MedicalNote"] }
  );
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "take=300", tables: ["Resident"] }
  );
  const clinician = useClinician(clinicianRole);

  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const PER_PAGE = 10;
  const [viewing, setViewing] = useState<NoteVM | null>(null);
  const [adding, setAdding] = useState(false);

  const residents = useMemo(() => residentRows.map(adaptResident), [residentRows]);
  const residentById = useMemo(() => new Map(residents.map((r) => [r.id, r])), [residents]);

  const notes = useMemo<NoteVM[]>(() => noteRows.map((row) => {
    const rid = asStr(row.residentId);
    const r = residentById.get(rid);
    return {
      id: String(row.id), title: asStr(row.title), content: asStr(row.content),
      noteType: asStr(row.noteType) || "CLINICAL_NOTE",
      authorName: asStr(row.authorName), residentId: rid,
      residentName: r?.name ?? "Unknown", room: r?.room ?? "—",
      createdAt: row.createdAt ? String(row.createdAt) : null,
    };
  }).filter((n) => n.noteType !== "MEDICATION_ADMIN"), [noteRows, residentById]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notes.filter((n) => {
      if (q && !n.title.toLowerCase().includes(q) && !n.residentName.toLowerCase().includes(q) && !n.content.toLowerCase().includes(q)) return false;
      if (typeFilter !== "all" && n.noteType !== typeFilter) return false;
      return true;
    }).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }, [notes, search, typeFilter]);

  useEffect(() => { setPage(1); }, [search, typeFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageClamped = Math.min(page, totalPages);
  const paginated = filtered.slice((pageClamped - 1) * PER_PAGE, pageClamped * PER_PAGE);

  const stats = useMemo(() => ({
    total: notes.length,
    today: notes.filter((n) => {
      if (!n.createdAt) return false;
      return new Date(n.createdAt).toDateString() === new Date(nowTs).toDateString();
    }).length,
    thisWeek: notes.filter((n) => n.createdAt && nowTs - new Date(n.createdAt).getTime() < 7 * 86400000).length,
  }), [notes, nowTs]);

  const handleDelete = async (n: NoteVM) => {
    const result = await Swal.fire({
      title: "Delete Note?", text: `"${n.title}" will be permanently deleted.`,
      icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete",
    });
    if (!result.isConfirmed) return;
    try {
      await deleteRecord("medical-notes", n.id);
      await refetch();
      setViewing(null);
      Swal.fire({ title: "Deleted", icon: "success", timer: 1300, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Delete Failed", text: err instanceof Error ? err.message : "Could not delete.", icon: "error" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <PenTool className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Clinical Notes
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            Voice-to-Text dictation &amp; AI-generated drafts — SOAP, progress &amp; clinical documentation
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={() => setAdding(true)} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">
            <Plus className="w-4 h-4" /> New Note
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <Stat label="Total Notes" value={stats.total} icon={FileText} tone="gray" />
        <Stat label="Created Today" value={stats.today} icon={Clock} tone="blue" />
        <Stat label="This Week" value={stats.thisWeek} icon={PenTool} tone="green" />
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
          <input type="text" placeholder="Search notes by title, patient, or content..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setTypeFilter("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${typeFilter === "all" ? "bg-yellow-400 text-black" : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
            All Types
          </button>
          {NOTE_TYPES.map((t) => (
            <button key={t.value} onClick={() => setTypeFilter(t.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${typeFilter === t.value ? "bg-yellow-400 text-black" : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
              {t.label}
            </button>
          ))}
          <span className="text-sm text-gray-500 ml-auto">{filtered.length} notes</span>
        </div>
      </div>

      {loading && notes.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">Loading notes...</div>
      ) : error ? (
        <div className="bg-white rounded-lg border border-red-200 p-10 text-center text-red-600">Failed to load: {error}</div>
      ) : filtered.length > 0 ? (
        <div className="space-y-2">
          {paginated.map((n) => (
            <div key={n.id} className="bg-white rounded-lg border border-gray-200 hover:border-yellow-300 hover:shadow-md transition p-4 flex items-start gap-3 sm:gap-4">
              <button onClick={() => setViewing(n)} className="flex items-start gap-3 sm:gap-4 min-w-0 flex-1 text-left">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-400 to-green-500 flex items-center justify-center flex-shrink-0">
                  <PenTool className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="font-bold text-gray-900 truncate">{n.title || "Clinical Note"}</h3>
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${TYPE_BADGE[n.noteType] || TYPE_BADGE.CLINICAL_NOTE}`}>{n.noteType.replace(/_/g, " ")}</span>
                  </div>
                  <p className="text-sm text-gray-600">{n.residentName} &middot; Room {n.room} &middot; {n.authorName || "Unknown"}</p>
                  {n.content && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{n.content.slice(0, 200)}</p>}
                </div>
              </button>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <span className="text-xs text-gray-500 whitespace-nowrap">{relTime(n.createdAt, nowTs)}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setViewing(n)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                  <button onClick={() => void handleDelete(n)} className="p-1.5 rounded hover:bg-red-100 text-red-500 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">
          {notes.length === 0 ? "No clinical notes yet. Create the first note." : "No notes match your search."}
        </div>
      )}

      {/* Pagination */}
      {filtered.length > PER_PAGE && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-gray-600">{(pageClamped - 1) * PER_PAGE + 1}–{Math.min(pageClamped * PER_PAGE, filtered.length)} of {filtered.length}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageClamped === 1}
              className="flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm font-medium">
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {pageClamped} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pageClamped === totalPages}
              className="flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm font-medium">
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-green-500 to-green-600 text-white p-5 sm:p-6 flex items-center justify-between z-10">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold">{viewing.title || "Clinical Note"}</h2>
                <p className="text-green-100 text-sm">{viewing.residentName} &middot; Room {viewing.room}</p>
              </div>
              <button onClick={() => setViewing(null)} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-sm font-bold ${TYPE_BADGE[viewing.noteType] || TYPE_BADGE.CLINICAL_NOTE}`}>{viewing.noteType.replace(/_/g, " ")}</span>
                <span className="text-sm text-gray-500">by {viewing.authorName || "Unknown"} &middot; {viewing.createdAt ? new Date(viewing.createdAt).toLocaleString() : "—"}</span>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <p className="text-gray-900 text-sm whitespace-pre-wrap">{viewing.content || "No content"}</p>
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between gap-2">
              <button onClick={() => setViewing(null)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Close</button>
              <button onClick={() => void handleDelete(viewing)}
                className="flex items-center gap-2 px-5 py-2 bg-red-50 text-red-600 border border-red-200 font-semibold rounded-lg hover:bg-red-100 transition">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {adding && (
        <AddNoteModal
          residents={residents.map((r) => ({ id: r.id, name: r.name, room: r.room }))}
          authorName={clinician.name}
          onClose={() => setAdding(false)}
          onSaved={() => { void refetch(); setAdding(false); }}
        />
      )}
    </div>
  );
}

/* ── Add Note modal: Voice-to-Text + AI-Generated Draft ── */

function AddNoteModal({ residents, authorName, onClose, onSaved }: {
  residents: { id: string; name: string; room: string }[]; authorName: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ residentId: "", title: "", content: "", noteType: "SOAP_NOTE" });
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const valid = form.residentId && form.title.trim() && form.content.trim();
  const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none text-sm";
  const patient = residents.find((r) => r.id === form.residentId);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) || null;
    if (!SR) { setSpeechSupported(false); return; }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (event: any) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
      }
      if (finalText) {
        setForm((f) => ({ ...f, content: (f.content ? f.content.replace(/\s*$/, "") + " " : "") + finalText.trim() }));
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    return () => { try { rec.stop(); } catch { /* noop */ } };
  }, []);

  const toggleDictation = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (listening) { try { rec.stop(); } catch { /* noop */ } setListening(false); return; }
    try { rec.start(); setListening(true); } catch { setListening(false); }
  }, [listening]);

  const localDraft = (dictation: string, noteType: string, name: string) => {
    const body = dictation.trim();
    if (noteType === "SOAP_NOTE") {
      return `SUBJECTIVE:\n${body || "(patient-reported findings)"}\n\nOBJECTIVE:\n(vitals, exam findings)\n\nASSESSMENT:\n(clinical impression)\n\nPLAN:\n(orders, follow-up)`;
    }
    return `${name ? `Patient: ${name}\n\n` : ""}${body || "(clinical findings)"}`;
  };

  const generateDraft = async () => {
    if (drafting) return;
    if (listening) { try { recognitionRef.current?.stop(); } catch { /* noop */ } setListening(false); }
    setDrafting(true);
    const typeLabel = NOTE_TYPES.find((t) => t.value === form.noteType)?.label ?? "Clinical Note";
    const dictation = form.content.trim();
    try {
      const persona =
        `You are an expert clinical documentation scribe at an assisted-living facility. ` +
        `Turn the clinician's dictation into a well-structured ${typeLabel}` +
        (patient ? ` for ${patient.name} (Room ${patient.room})` : "") + `. ` +
        `Use precise clinical language. For a SOAP Note use SUBJECTIVE / OBJECTIVE / ASSESSMENT / PLAN headings. ` +
        `Only output the note body — no preamble, no markdown fences.`;
      const res = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat",
          audience: "admin",
          persona,
          message: dictation || `Draft a ${typeLabel} template${patient ? ` for ${patient.name}` : ""}.`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const reply = String(data?.reply ?? "").trim();
      // Only trust a real model draft; otherwise structure the dictation locally.
      const draft = data?.source === "gemini" && reply ? reply : localDraft(dictation, form.noteType, patient?.name ?? "");
      setForm((f) => ({
        ...f,
        content: draft,
        title: f.title.trim() || `${typeLabel}${patient ? ` — ${patient.name}` : ""}`,
      }));
    } catch {
      setForm((f) => ({ ...f, content: localDraft(dictation, form.noteType, patient?.name ?? "") }));
    } finally {
      setDrafting(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    if (listening) { try { recognitionRef.current?.stop(); } catch { /* noop */ } }
    setSaving(true);
    try {
      await createRecord("medical-notes", {
        residentId: form.residentId, title: form.title.trim(), content: form.content.trim(),
        noteType: form.noteType, authorName,
      });
      Swal.fire({ title: "Note Created", icon: "success", timer: 1400, showConfirmButton: false });
      onSaved();
    } catch (err) {
      setSaving(false);
      Swal.fire({ title: "Save Failed", text: err instanceof Error ? err.message : "Could not save note.", icon: "error" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-green-500 to-green-600 text-white p-5 sm:p-6 flex items-center justify-between z-10">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">New Clinical Note</h2>
            <p className="text-green-100 text-sm">Dictate by voice, then draft with AI — or type directly</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Patient <span className="text-red-500">*</span></label>
                <select value={form.residentId} onChange={set("residentId")} className={inputCls}>
                  <option value="">Select patient...</option>
                  {residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Note Type</label>
                <select value={form.noteType} onChange={set("noteType")} className={inputCls}>
                  {NOTE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Title <span className="text-red-500">*</span></label>
              <input type="text" value={form.title} onChange={set("title")} placeholder="SOAP Note — patient assessment..." className={inputCls} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                <label className="block text-sm font-semibold text-gray-700">Content <span className="text-red-500">*</span></label>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={toggleDictation} disabled={!speechSupported}
                    title={speechSupported ? "Dictate with your microphone" : "Voice input not supported in this browser"}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                      listening ? "bg-red-500 text-white animate-pulse" : "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                    }`}>
                    {listening ? <><MicOff className="w-3.5 h-3.5" /> Stop</> : <><Mic className="w-3.5 h-3.5" /> Voice-to-Text</>}
                  </button>
                  <button type="button" onClick={() => void generateDraft()} disabled={drafting}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-purple-500 to-purple-600 text-white hover:shadow-md transition disabled:opacity-50">
                    {drafting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Drafting…</> : <><Sparkles className="w-3.5 h-3.5" /> AI Draft</>}
                  </button>
                </div>
              </div>
              <textarea value={form.content} onChange={set("content")} rows={11}
                placeholder={listening ? "Listening… speak your note." : "Dictate with the mic, generate an AI draft, or type here."}
                className={`${inputCls} resize-y font-mono text-sm ${listening ? "ring-2 ring-red-300" : ""}`} />
              <p className="text-[11px] text-gray-400 mt-1">
                {speechSupported ? "Voice-to-Text uses your browser's speech engine (on-device)." : "Voice-to-Text unavailable — type or use AI Draft."}
                {" "}AI Draft structures your dictation into a {NOTE_TYPES.find((t) => t.value === form.noteType)?.label ?? "note"}.
              </p>
            </div>
          </div>
          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between gap-2">
            <button type="button" onClick={onClose} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
            <button type="submit" disabled={!valid || saving}
              className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-green-400 to-green-500 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed">
              <PenTool className="w-4 h-4" /> {saving ? "Saving..." : "Save Note"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  gray: { wrap: "bg-white border-gray-200", icon: "text-gray-500", value: "text-gray-900" },
  blue: { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-500", value: "text-blue-600" },
  green: { wrap: "bg-green-50 border-green-200", icon: "text-green-500", value: "text-green-600" },
};
function Stat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: LucideIcon; tone: keyof typeof TONES }) {
  const t = TONES[tone];
  return (
    <div className={`p-4 rounded-lg border ${t.wrap}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs sm:text-sm text-gray-600 font-semibold">{label}</p>
        <Icon className={`w-4 h-4 ${t.icon}`} />
      </div>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 ${t.value}`}>{value}</p>
    </div>
  );
}
