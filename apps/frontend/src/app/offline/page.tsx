"use client";

// Fallback document served by the service worker when a page load happens with
// no network AND that route has never been visited (so there's no cached HTML).
// Any route the user has opened before boots the real shell instead of this.

import { useEffect, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";

export default function OfflinePage() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <CloudOff className="mx-auto h-10 w-10 text-slate-400" />
        <h1 className="mt-4 text-lg font-bold text-slate-900 dark:text-slate-100">
          You&rsquo;re offline
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          This page hasn&rsquo;t been opened on this device yet, so there&rsquo;s nothing
          saved to show. Pages you&rsquo;ve already visited still work without a signal.
        </p>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
          Anything you record while offline is saved on this device and uploads
          automatically once you reconnect.
        </p>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>

        <p className="mt-4 text-xs font-semibold" aria-live="polite">
          {online
            ? <span className="text-emerald-600">Connection is back — tap Try again.</span>
            : <span className="text-red-500">Still no connection.</span>}
        </p>
      </div>
    </main>
  );
}
