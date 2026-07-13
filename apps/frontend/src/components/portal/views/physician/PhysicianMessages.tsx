"use client";

import { useMemo, useState, useEffect } from "react";
import {
  MessageSquare, Search, Plus, Send, RefreshCw, Clock, User,
  type LucideIcon,
} from "lucide-react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord } from "@/lib/api";

interface MessageVM {
  id: string; content: string; senderName: string; senderRole: string;
  recipientName: string; recipientId: string; createdAt: string | null;
  isRead: boolean; messageType: string;
}

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

export default function PhysicianMessages() {
  const { data: messageRows, loading, refetch } = useLiveQuery<Record<string, unknown>>(
    "messages", { query: "take=200", tables: ["Message"] }
  );
  const { data: userRows } = useLiveQuery<Record<string, unknown>>(
    "users", { query: "take=100", tables: ["User"] }
  );
  const { data: staffRows } = useLiveQuery<Record<string, unknown>>(
    "staff", { query: "include=user", tables: ["Staff"] }
  );

  const physicianName = useMemo(() => {
    const physician = staffRows.find((s: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const pos = String(s.position || "").toUpperCase();
      return pos.includes("PHYSICIAN") || pos.includes("DOCTOR");
    });
    if (physician?.user) {
      const u = physician.user as Record<string, unknown>;
      return `${String(u.firstName || "")} ${String(u.lastName || "")}`.trim() || "Physician";
    }
    return "Physician";
  }, [staffRows]);

  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const [composing, setComposing] = useState(false);
  const [newRecipient, setNewRecipient] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [newSubject, setNewSubject] = useState("");

  const messages = useMemo<MessageVM[]>(() => messageRows.map((row) => ({
    id: String(row.id), content: asStr(row.content), senderName: asStr(row.senderName) || "Unknown",
    senderRole: asStr(row.senderRole), recipientName: asStr(row.recipientName),
    recipientId: asStr(row.recipientId), createdAt: row.createdAt ? String(row.createdAt) : null,
    isRead: Boolean(row.isRead), messageType: asStr(row.messageType) || "GENERAL",
  })).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")), [messageRows]);

  const users = useMemo(() => userRows.map((row) => ({
    id: String(row.id), name: asStr(row.name), role: asStr(row.role), email: asStr(row.email),
  })).filter((u) => u.role !== "PHYSICIAN"), [userRows]);

  const stats = useMemo(() => ({
    total: messages.length,
    unread: messages.filter((m) => !m.isRead).length,
    sent: messages.filter((m) => m.senderRole === "PHYSICIAN").length,
  }), [messages]);

  const handleSend = async () => {
    if (!newRecipient || !newMessage.trim()) return;
    try {
      await createRecord("messages", {
        content: newMessage.trim(),
        senderName: physicianName,
        senderRole: "PHYSICIAN",
        recipientId: newRecipient,
        recipientName: users.find((u) => u.id === newRecipient)?.name || "",
        messageType: "CLINICAL",
        isRead: false,
      });
      Swal.fire({ title: "Message Sent", icon: "success", timer: 1400, showConfirmButton: false });
      setComposing(false);
      setNewMessage("");
      setNewRecipient("");
      setNewSubject("");
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Send Failed", text: err instanceof Error ? err.message : "Could not send message.", icon: "error" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <MessageSquare className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Messages
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            Clinical communication with nurses, staff, and care team
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={() => setComposing(true)} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">
            <Plus className="w-4 h-4" /> Compose
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <Stat label="Total Messages" value={stats.total} icon={MessageSquare} tone="gray" />
        <Stat label="Unread" value={stats.unread} icon={Clock} tone="red" />
        <Stat label="Sent by Me" value={stats.sent} icon={Send} tone="blue" />
      </div>

      {loading && messages.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">Loading messages...</div>
      ) : messages.length > 0 ? (
        <div className="space-y-2">
          {messages.map((m) => (
            <div key={m.id} className={`bg-white rounded-lg border transition p-4 flex items-start gap-4 ${!m.isRead ? "border-yellow-300 bg-yellow-50/30" : "border-gray-200"}`}>
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-500 flex items-center justify-center text-white font-bold flex-shrink-0 text-sm">
                {m.senderName.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h3 className={`font-semibold text-sm ${!m.isRead ? "text-gray-900" : "text-gray-700"}`}>{m.senderName}</h3>
                  <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-semibold">{m.senderRole}</span>
                  {m.messageType && m.messageType !== "GENERAL" && (
                    <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-semibold">{m.messageType}</span>
                  )}
                  {!m.isRead && <span className="w-2 h-2 rounded-full bg-blue-500" />}
                </div>
                <p className={`text-sm mb-1 ${!m.isRead ? "font-medium text-gray-900" : "text-gray-700"}`}>{m.content.slice(0, 200)}</p>
                <p className="text-xs text-gray-500">{relTime(m.createdAt, nowTs)}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">
          <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-lg font-medium">No messages yet</p>
          <p className="text-sm">Start a conversation with your care team.</p>
        </div>
      )}

      {/* Compose Modal */}
      {composing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="bg-gradient-to-r from-yellow-400 to-yellow-500 text-black p-5 flex items-center justify-between">
              <h2 className="text-xl font-bold">Compose Message</h2>
              <button onClick={() => setComposing(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><span className="text-lg">&times;</span></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Recipient</label>
                <select value={newRecipient} onChange={(e) => setNewRecipient(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none text-sm">
                  <option value="">Select recipient...</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Subject</label>
                <input type="text" value={newSubject} onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="Subject..." className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none text-sm" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Message</label>
                <textarea value={newMessage} onChange={(e) => setNewMessage(e.target.value)} rows={5}
                  placeholder="Type your message..." className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none resize-y text-sm" />
              </div>
            </div>
            <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between gap-2">
              <button onClick={() => setComposing(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
              <button onClick={() => void handleSend()} disabled={!newRecipient || !newMessage.trim()}
                className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed">
                <Send className="w-4 h-4" /> Send
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
  red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
  blue: { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-500", value: "text-blue-600" },
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
