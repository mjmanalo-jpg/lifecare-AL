"use client";

// Route-level error boundary. Catches anything thrown while rendering a child
// segment — including the [role] layout's tenant-context resolution (a slow or
// unreachable DB pooler throws here) and the portal content views. Without this
// Next.js falls back to its bare "A server error occurred" white page with no
// in-app recovery; here we give a branded screen with a real retry.
import { useEffect } from "react";
import { AlertTriangle, RefreshCw, LogIn } from "lucide-react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface the digest in the browser console to correlate with server logs.
    console.error("Portal render error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-5 w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-red-600" />
        </div>
        <h1 className="text-xl font-bold mb-1.5">This page hit a snag</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          A temporary server error occurred while loading this view. This is usually
          transient — try again in a moment.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
          <button
            onClick={() => reset()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#2E4A48] hover:bg-[#25403D] text-white font-semibold text-sm transition"
          >
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
          <button
            onClick={() => { window.location.href = "/login"; }}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-white/5 font-semibold text-sm transition"
          >
            <LogIn className="w-4 h-4" /> Back to login
          </button>
        </div>
        {error.digest && (
          <p className="mt-6 text-[11px] font-mono text-gray-400">Reference: {error.digest}</p>
        )}
      </div>
    </div>
  );
}
