"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useState } from "react";
import {
  MessageSquare, AlertTriangle, CheckCircle2, RefreshCw, Search, Plus, X, Send, Mail,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord } from "@/lib/api";
import { humanize } from "@/lib/adapters";
import {
  useNowTs, relTime, ReportStat, TabLoading, EmptyState, LiveBadge, FormField,
  type Row,
} from "./shared";

const TYPE: Record<string, { label: string; badge: string }> = {
  GENERAL: { label: "General", badge: "bg-gray-100 text-gray-700" },
  NOTIFICATION: { label: "Notification", badge: "bg-blue-100 text-blue-700" },
  ALERT: { label: "Alert", badge: "bg-orange-100 text-orange-700" },
  URGENT: { label: "Urgent", badge: "bg-red-100 text-red-700" },
};
const typeMeta = (t: string) => TYPE[t] ?? TYPE.GENERAL;

/** Messages — live two-way conversation with the care team. */
export default function FamilyMessages() {
  const nowTs = useNowTs();
  const { data: messageRows, loading: messageLoading, refetch: refetchMessages } = useLiveQuery("messages", {
    query: "include=sender&take=100",
    tables: ["Message"],
  });

  const [showCompose, setShowCompose] = useState(false);
  const [sendingMsg, setSendingMsg] = useState(false);
  const [msgStatus, setMsgStatus] = useState<"all" | "unread">("all");
  const [msgType, setMsgType] = useState<string>("all");
  const [msgSearch, setMsgSearch] = useState("");
  const [composeForm, setComposeForm] = useState({ subject: "", content: "", messageType: "GENERAL" });

  const msgs = messageRows.map((m: Row, i: number) => {
    const sender = m.sender as { name?: string } | undefined;
    return {
      id: String(m.id ?? i),
      subject: String(m.subject ?? "") || humanize(String(m.messageType ?? "")) || "Message",
      content: String(m.content ?? ""),
      type: String(m.messageType ?? "GENERAL"),
      isRead: Boolean(m.isRead),
      from: sender?.name ?? "Care Team",
      ts: m.createdAt ? new Date(String(m.createdAt)).getTime() : 0,
      createdAt: m.createdAt ? new Date(String(m.createdAt)).toLocaleString() : "",
    };
  });

  const unread = msgs.filter((m) => !m.isRead).length;
  const urgent = msgs.filter((m) => (m.type === "URGENT" || m.type === "ALERT") && !m.isRead).length;
  const q = msgSearch.trim().toLowerCase();
  const filtered = msgs
    .filter((m) => (msgStatus === "unread" ? !m.isRead : true))
    .filter((m) => msgType === "all" || m.type === msgType)
    .filter((m) => !q || m.subject.toLowerCase().includes(q) || m.content.toLowerCase().includes(q) || m.from.toLowerCase().includes(q))
    .sort((a, b) => b.ts - a.ts);

  const markRead = async (id: string) => {
    try {
      await updateRecord("messages", id, { isRead: true, readAt: new Date().toISOString() });
      await refetchMessages();
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not mark as read.", icon: "error" });
    }
  };

  const sendMessage = async () => {
    if (!composeForm.content.trim()) { Swal.fire({ title: "Message empty", text: "Write a message before sending.", icon: "warning" }); return; }
    setSendingMsg(true);
    try {
      await createRecord("messages", {
        subject: composeForm.subject.trim() || null,
        content: composeForm.content.trim(),
        messageType: composeForm.messageType,
        isRead: false,
      });
      await refetchMessages();
      setShowCompose(false);
      setComposeForm({ subject: "", content: "", messageType: "GENERAL" });
      Swal.fire({ title: "Message Sent", icon: "success", timer: 1400, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Send Failed", text: err instanceof Error ? err.message : "Could not send message.", icon: "error" });
    } finally {
      setSendingMsg(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <MessageSquare className="w-6 h-6 text-blue-500 flex-shrink-0" /> Messages
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
            <LiveBadge />
            Conversations with the care team
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton onRefresh={() => void refetchMessages()} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium" />
          <button onClick={() => { setComposeForm({ subject: "", content: "", messageType: "GENERAL" }); setShowCompose(true); }} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-lg hover:shadow-lg transition text-sm"><Plus className="w-4 h-4" /> New Message</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <ReportStat label="Total" value={msgs.length} icon={MessageSquare} tone="gray" />
        <ReportStat label="Unread" value={unread} icon={Mail} tone={unread > 0 ? "blue" : "green"} />
        <ReportStat label="Urgent" value={urgent} icon={AlertTriangle} tone={urgent > 0 ? "red" : "green"} />
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden bg-white">
          {(["all", "unread"] as const).map((f) => (
            <button key={f} onClick={() => setMsgStatus(f)} className={`flex-1 px-4 py-2 text-sm font-medium capitalize transition ${msgStatus === f ? "bg-blue-500 text-white" : "text-gray-700 hover:bg-gray-50"}`}>{f}</button>
          ))}
        </div>
        <select value={msgType} onChange={(e) => setMsgType(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-400 outline-none">
          <option value="all">All Types</option>
          {Object.keys(TYPE).map((k) => <option key={k} value={k}>{TYPE[k].label}</option>)}
        </select>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
          <input type="text" placeholder="Search messages…" value={msgSearch} onChange={(e) => setMsgSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-400 focus:border-transparent outline-none" />
        </div>
      </div>

      {/* List */}
      {messageLoading && messageRows.length === 0 ? (
        <TabLoading label="Loading messages..." />
      ) : msgs.length === 0 ? (
        <EmptyState message="No messages yet. Start a conversation with the care team." />
      ) : filtered.length === 0 ? (
        <EmptyState message="No messages match your filters." />
      ) : (
        <div className="space-y-3">
          {filtered.map((m) => (
            <div key={m.id} className={`bg-white rounded-lg p-4 border ${m.isRead ? "border-gray-200" : "border-blue-300 bg-blue-50/40"}`}>
              <div className="flex items-start gap-3">
                {!m.isRead && <span className="w-2 h-2 rounded-full bg-blue-500 mt-2 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <h4 className={`font-semibold ${m.isRead ? "text-gray-800" : "text-gray-900"}`}>{m.subject}</h4>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${typeMeta(m.type).badge}`}>{typeMeta(m.type).label}</span>
                      <span className="text-xs text-gray-400">{relTime(m.ts, nowTs)}</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">From {m.from}</p>
                  <p className="text-sm text-gray-700 mt-2">{m.content}</p>
                  <div className="flex items-center justify-between gap-2 mt-2">
                    <span className="text-xs text-gray-400">{m.createdAt}</span>
                    {!m.isRead && (
                      <button onClick={() => void markRead(m.id)} className="flex items-center gap-1 px-2.5 py-1 text-blue-600 hover:bg-blue-50 rounded text-xs font-medium transition"><CheckCircle2 className="w-3.5 h-3.5" /> Mark read</button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Compose modal */}
      {showCompose && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-blue-600 text-white p-5 flex items-center justify-between">
              <h2 className="text-xl font-bold">Message Care Team</h2>
              <button onClick={() => setShowCompose(false)} className="p-2 hover:bg-white/10 rounded-lg transition"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <FormField label="Subject"><input type="text" value={composeForm.subject} onChange={(e) => setComposeForm((f) => ({ ...f, subject: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-400 outline-none" /></FormField>
              <FormField label="Priority"><select value={composeForm.messageType} onChange={(e) => setComposeForm((f) => ({ ...f, messageType: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-400 outline-none">{Object.keys(TYPE).map((k) => <option key={k} value={k}>{TYPE[k].label}</option>)}</select></FormField>
              <FormField label="Message *"><textarea value={composeForm.content} onChange={(e) => setComposeForm((f) => ({ ...f, content: e.target.value }))} rows={4} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-400 outline-none resize-y" placeholder="Write your message to the care team…" /></FormField>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowCompose(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
              <button onClick={() => void sendMessage()} disabled={sendingMsg} className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-60"><Send className="w-4 h-4" /> {sendingMsg ? "Sending…" : "Send"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
