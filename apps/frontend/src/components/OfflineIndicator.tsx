"use client";

// Global sync status pill. Renders nothing when online with an empty outbox;
// otherwise shows offline state / pending count / syncing, with a "Sync now"
// action. Mount once in the app shell; it also starts the sync engine.

import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, UploadCloud, Check } from "lucide-react";
import { useOfflineSync, startOfflineSync, subscribeSync, getSyncStatus } from "@/lib/offline/sync";

export default function OfflineIndicator() {
  const { online, pending, syncing, lastError, syncNow } = useOfflineSync();
  const [justSynced, setJustSynced] = useState(false);

  useEffect(() => { startOfflineSync(); }, []);

  // Flash a brief "Synced" confirmation when the outbox drains to zero. Driven by
  // the sync subscription (external system) — the allowed place to call setState.
  useEffect(() => {
    let prev = getSyncStatus().pending;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeSync((st) => {
      if (prev > 0 && st.pending === 0 && st.online) {
        setJustSynced(true);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => setJustSynced(false), 2500);
      }
      prev = st.pending;
    });
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, []);

  const idle = online && pending === 0 && !syncing;
  if (idle && !justSynced) return null;

  let tone = "bg-amber-100 text-amber-800 border-amber-200";
  let Icon = UploadCloud;
  let text: string;

  if (!online) {
    tone = "bg-red-100 text-red-700 border-red-200";
    Icon = CloudOff;
    text = pending > 0 ? `Offline — ${pending} change${pending === 1 ? "" : "s"} saved locally` : "Offline — working from cached data";
  } else if (syncing) {
    tone = "bg-blue-100 text-blue-700 border-blue-200";
    Icon = RefreshCw;
    text = `Syncing${pending ? ` ${pending}` : ""}…`;
  } else if (pending > 0) {
    Icon = UploadCloud;
    text = `${pending} change${pending === 1 ? "" : "s"} pending`;
  } else {
    tone = "bg-emerald-100 text-emerald-700 border-emerald-200";
    Icon = Check;
    text = "All changes synced";
  }

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`} title={lastError || undefined}>
      <Icon className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
      <span className="max-w-[220px] truncate">{text}</span>
      {online && pending > 0 && !syncing && (
        <button type="button" onClick={() => void syncNow()} className="ml-0.5 rounded px-1.5 py-0.5 text-[11px] font-bold underline underline-offset-2 hover:opacity-80">
          Sync now
        </button>
      )}
    </div>
  );
}
