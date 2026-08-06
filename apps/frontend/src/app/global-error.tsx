"use client";

// Ultimate fallback: catches errors thrown by the ROOT layout itself (which the
// segment-level error.tsx cannot). This replaces the whole document, so it must
// render its own <html>/<body> and cannot rely on globals.css or app fonts —
// styles are inlined and kept minimal so this screen can never itself fail.
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Fatal app error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", background: "#ffffff", color: "#111827" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
          <div style={{ maxWidth: "420px", textAlign: "center" }}>
            <div style={{ margin: "0 auto 20px", width: "56px", height: "56px", borderRadius: "9999px", background: "#fee2e2", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h1 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 6px" }}>Something went wrong</h1>
            <p style={{ fontSize: "14px", color: "#6b7280", margin: "0 0 24px", lineHeight: 1.5 }}>
              A server error occurred. This is usually temporary — please try again.
            </p>
            <button
              onClick={() => reset()}
              style={{ padding: "10px 22px", borderRadius: "8px", background: "#2E4A48", color: "#fff", fontWeight: 600, fontSize: "14px", border: "none", cursor: "pointer" }}
            >
              Try again
            </button>
            {error.digest && (
              <p style={{ marginTop: "24px", fontSize: "11px", fontFamily: "monospace", color: "#9ca3af" }}>Reference: {error.digest}</p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
