"use client";

import { useMemo, useState, useEffect } from "react";
import {
  MessageSquare, X, Plus, RefreshCw, Clock, Send, ShieldCheck, Loader2,
  Search, Eye, Trash2, ChevronLeft, ChevronRight, Inbox, ArrowUpRight,
  ArrowDownLeft, Reply, type LucideIcon,
} from "lucide-react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import { useClinician, type ClinicianRole } from "./useClinician";

const asStr = (v: unknown): string => (v == null ? "" : String(v));
const rel = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

interface MessageVM {
  id: string; content: string; subject: string; messageType: string;
  senderId: string; senderName: string; recipientId: string; recipientName: string;
  isRead: boolean; createdAt: string | null;
}

const TYPES = [
  { value: "ALL", label: "All Types" },
  { value: "GENERAL", label: "Routine" },
  { value: "ALERT", label: "Handover / Alert" },
  { value: "URGENT", label: "Urgent" },
];
const TYPE_BADGE: Record<string, string> = {
  GENERAL: "bg-gray-100 text-gray-700",
  ALERT: "bg-amber-100 text-amber-700",
  URGENT: "bg-red-100 text-red-700",
  NOTIFICATION: "bg-blue-100 text-blue-700",
};
const DIRECTION_FILTERS = ["all", "inbox", "sent"] as const;
const READ_FILTERS = ["all", "unread", "read"] as const;

function relTime(iso: string | null, nowTs: number): string {
  if (!iso || !nowTs) return "—";
  const m = Math.round((nowTs - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function ClinicalMessages({ clinicianRole = "PHYSICIAN" }: { clinicianRole?: ClinicianRole }) {
  const { data: messageRows, loading, refetch } = useLiveQuery<Record<string, unknown>>(
    "messages", { query: "include=sender,recipient&take=500", tables: ["Message"] }
  );
  const { data: userRows } = useLiveQuery<Record<string, unknown>>(
    "users", { query: "take=200", tables: ["User"] }
  );
  const clinician = useClinician(clinicianRole);

  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [directionFilter, setDirectionFilter] = useState<"all" | "inbox" | "sent">("all");
  const [readFilter, setReadFilter] = useState<"all" | "unread" | "read">("all");
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<MessageVM | null>(null);
  const [composing, setComposing] = useState(false);
  const [recipientId, setRecipientId] = useState("");
  const [subject, setSubject] = useState("");
  const [messageType, setMessageType] = useState("GENERAL");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const perPage = 15;

  const messages = useMemo<MessageVM[]>(() => messageRows.map((row) => {
    const sender = rel(row.sender);
    const recipient = rel(row.recipient);
    return {
      id: String(row.id), content: asStr(row.content), subject: asStr(row.subject),
      messageType: asStr(row.messageType) || "GENERAL",
      senderId: asStr(row.senderId), senderName: asStr(sender.name) || "Unknown",
      recipientId: asStr(row.recipientId), recipientName: asStr(recipient.name) || "Unknown",
      isRead: Boolean(row.isRead), createdAt: row.createdAt ? String(row.createdAt) : null,
    };
  }).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")), [messageRows]);

  const users = useMemo(() => userRows
    .map((row) => ({ id: String(row.id), name: asStr(row.name), role: asStr(row.role), isActive: row.isActive !== false }))
    .filter((u) => u.isActive && u.id !== clinician.userId), [userRows, clinician.userId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return messages.filter((m) => {
      if (q && !m.senderName.toLowerCase().includes(q) && !m.recipientName.toLowerCase().includes(q) && !m.subject.toLowerCase().includes(q) && !m.content.toLowerCase().includes(q)) return false;
      if (typeFilter !== "ALL" && m.messageType !== typeFilter) return false;
      if (directionFilter === "inbox" && m.recipientId !== clinician.userId) return false;
      if (directionFilter === "sent" && m.senderId !== clinician.userId) return false;
      if (readFilter === "unread" && m.isRead) return false;
      if (readFilter === "read" && !m.isRead) return false;
      return true;
    });
  }, [messages, search, typeFilter, directionFilter, readFilter, clinician.userId]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  useEffect(() => { setPage(1); }, [search, typeFilter, directionFilter, readFilter]);

  const stats = useMemo(() => ({
    total: messages.length,
    unread: messages.filter((m) => !m.isRead).length,
    sent: messages.filter((m) => m.senderId === clinician.userId).length,
    received: messages.filter((m) => m.recipientId === clinician.userId).length,
    urgent: messages.filter((m) => m.messageType === "URGENT" && !m.isRead).length,
  }), [messages, clinician.userId]);

  const markRead = async (m: MessageVM) => {
    if (m.isRead || m.recipientId !== clinician.userId) return;
    try { await updateRecord("messages", m.id, { isRead: true, readAt: new Date().toISOString() }); await refetch(); }
    catch { /* non-blocking */ }
  };

  const handleSend = async () => {
    if (!recipientId || !content.trim() || sending) return;
    if (!clinician.userId) {
      Swal.fire({ title: "No Linked Account", text: "Your clinician profile isn't linked to a user account yet.", icon: "warning" });
      return;
    }
    setSending(true);
    try {
      await createRecord("messages", {
        senderId: clinician.userId,
        recipientId,
        subject: subject.trim() || (messageType === "ALERT" ? "Shift Handover" : null),
        content: content.trim(),
        messageType,
        isRead: false,
      });
      Swal.fire({ title: "Message Sent", icon: "success", timer: 1300, showConfirmButton: false });
      setComposing(false); setContent(""); setRecipientId(""); setSubject(""); setMessageType("GENERAL");
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Send Failed", text: err instanceof Error ? err.message : "Could not send message.", icon: "error" });
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (m: MessageVM) => {
    const result = await Swal.fire({
      title: "Delete Message?", text: "This action cannot be undone.", icon: "warning",
      showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete",
    });
    if (!result.isConfirmed) return;
    try { await deleteRecord("messages", m.id); await refetch(); Swal.fire({ title: "Deleted", icon: "success", timer: 1200, showConfirmButton: false }); }
    catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not delete.", icon: "error" }); }
  };

  const handleReply = (m: MessageVM) => {
    const replyTo = m.senderId === clinician.userId ? m.recipientId : m.senderId;
    const replyName = m.senderId === clinician.userId ? m.recipientName : m.senderName;
    setRecipientId(replyTo);
    setSubject(m.subject ? `Re: ${m.subject}` : "");
    setMessageType(m.messageType === "URGENT" ? "URGENT" : "GENERAL");
    setContent(`\n\n--- Original message from ${m.senderName} (${m.createdAt ? new Date(m.createdAt).toLocaleString() : ""}) ---\n${m.content}`);
    setViewing(null);
    setComposing(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <MessageSquare className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Secure Messages
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            Encrypted-at-rest care-team messaging &amp; shift handover
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={() => setComposing(true)} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">
            <Plus className="w-4 h-4" /> Compose
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Total" value={stats.total} icon={MessageSquare} tone="gray" />
        <Stat label="Unread" value={stats.unread} icon={Clock} tone="red" />
        <Stat label="Sent" value={stats.sent} icon={ArrowUpRight} tone="blue" />
        <Stat label="Received" value={stats.received} icon={ArrowDownLeft} tone="green" />
        <Stat label="Urgent Unread" value={stats.urgent} icon={ShieldCheck} tone="amber" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search name, subject, or content…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <div className="flex gap-1">
          {DIRECTION_FILTERS.map((d) => (
            <button key={d} onClick={() => setDirectionFilter(d)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${directionFilter === d ? "bg-yellow-400 text-black border-yellow-400" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
              {d === "all" ? "All" : d === "inbox" ? "Inbox" : "Sent"}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {READ_FILTERS.map((r) => (
            <button key={r} onClick={() => setReadFilter(r)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${readFilter === r ? "bg-yellow-400 text-black border-yellow-400" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
              {r === "all" ? "All" : r === "unread" ? "Unread" : "Read"}
            </button>
          ))}
        </div>
      </div>

      {/* Messages list */}
      {loading && messages.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">Loading messages...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">
          <Inbox className="w-10 h-10 mx-auto mb-2 text-gray-300" />
          {messages.length === 0 ? "No messages yet. Compose the first message." : "No messages match your filters."}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {paginated.map((m) => {
              const mine = m.senderId === clinician.userId;
              const inbound = m.recipientId === clinician.userId;
              return (
                <div key={m.id}
                  className={`bg-white rounded-lg border transition p-4 flex items-start gap-3 sm:gap-4 ${inbound && !m.isRead ? "border-yellow-300 bg-yellow-50/30" : "border-gray-200 hover:bg-gray-50"}`}>
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-500 flex items-center justify-center text-white font-bold flex-shrink-0">
                    {(mine ? "Me" : m.senderName).charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1 cursor-pointer" onClick={() => { void markRead(m); setViewing(m); }}>
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <h3 className={`font-semibold text-sm ${inbound && !m.isRead ? "text-gray-900" : "text-gray-700"}`}>
                        {mine ? `To: ${m.recipientName}` : m.senderName}
                      </h3>
                      <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${TYPE_BADGE[m.messageType] || TYPE_BADGE.GENERAL}`}>
                        {TYPES.find((t) => t.value === m.messageType)?.label ?? m.messageType}
                      </span>
                      {inbound && !m.isRead && <span className="w-2 h-2 rounded-full bg-yellow-500" />}
                    </div>
                    {m.subject && <p className="text-sm font-medium text-gray-800">{m.subject}</p>}
                    <p className="text-sm text-gray-600 line-clamp-2">{m.content}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-xs text-gray-500">{relTime(m.createdAt, nowTs)}</span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setViewing(m)} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View"><Eye className="w-3.5 h-3.5" /></button>
                      <button onClick={() => handleReply(m)} className="p-1.5 rounded hover:bg-green-100 text-green-600 transition" title="Reply"><Reply className="w-3.5 h-3.5" /></button>
                      <button onClick={() => void handleDelete(m)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">{filtered.length} messages total</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                  className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm"><ChevronLeft className="w-4 h-4" /></button>
                <span className="text-sm font-medium text-gray-700">Page {page} of {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                  className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </>
      )}

      {/* View Modal */}
      {viewing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setViewing(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-blue-600 text-white p-5 flex items-center justify-between z-10">
              <div className="min-w-0">
                <h2 className="text-xl font-bold truncate">{viewing.subject || "No Subject"}</h2>
                <p className="text-blue-100 text-sm truncate">
                  {viewing.senderName} → {viewing.recipientName}
                </p>
              </div>
              <button onClick={() => setViewing(null)} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Type</p>
                  <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[11px] font-semibold ${TYPE_BADGE[viewing.messageType] || TYPE_BADGE.GENERAL}`}>
                    {TYPES.find((t) => t.value === viewing.messageType)?.label ?? viewing.messageType}
                  </span>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Status</p>
                  <p className="text-sm font-medium text-gray-900 mt-0.5">{viewing.isRead ? "Read" : "Unread"}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Sent</p>
                  <p className="text-sm font-medium text-gray-900 mt-0.5">{viewing.createdAt ? new Date(viewing.createdAt).toLocaleString() : "—"}</p>
                </div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">From</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">{viewing.senderName}</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">To</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">{viewing.recipientName}</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Message</p>
                <p className="text-sm text-gray-900 mt-1 whitespace-pre-wrap leading-relaxed">{viewing.content}</p>
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setViewing(null)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Close</button>
              <div className="flex items-center gap-2">
                <button onClick={() => handleReply(viewing)}
                  className="flex items-center gap-1.5 px-5 py-2 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-lg transition text-sm">
                  <Reply className="w-4 h-4" /> Reply
                </button>
                {viewing.recipientId === clinician.userId && !viewing.isRead && (
                  <button onClick={() => { void markRead(viewing); setViewing({ ...viewing, isRead: true }); }}
                    className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition text-sm">Mark as Read</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Compose Modal */}
      {composing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setComposing(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-blue-600 text-white p-5 sm:p-6 flex items-center justify-between z-10">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                  {subject.startsWith("Re:") ? <><Reply className="w-6 h-6" /> Reply</> : <><ShieldCheck className="w-6 h-6" /> Compose</>}
                </h2>
                <p className="text-blue-100 text-sm">From {clinician.name}</p>
              </div>
              <button onClick={() => setComposing(false)} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Recipient <span className="text-red-500">*</span></label>
                <select value={recipientId} onChange={(e) => setRecipientId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                  <option value="">Select recipient...</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Priority</label>
                  <select value={messageType} onChange={(e) => setMessageType(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    {TYPES.filter((t) => t.value !== "ALL").map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Subject</label>
                  <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Optional" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Message <span className="text-red-500">*</span></label>
                <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} placeholder="Handover summary, clinical update, or request…" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none resize-y" />
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between gap-2">
              <button onClick={() => setComposing(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
              <button onClick={() => void handleSend()} disabled={!recipientId || !content.trim() || sending}
                className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-blue-400 to-blue-500 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  gray: { wrap: "bg-white border-gray-200", icon: "text-gray-500", value: "text-gray-900" },
  blue: { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-500", value: "text-blue-600" },
  red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
  green: { wrap: "bg-green-50 border-green-200", icon: "text-green-500", value: "text-green-600" },
  amber: { wrap: "bg-amber-50 border-amber-200", icon: "text-amber-500", value: "text-amber-600" },
};
function Stat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: LucideIcon; tone: keyof typeof TONES }) {
  const t = TONES[tone] || TONES.gray;
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
