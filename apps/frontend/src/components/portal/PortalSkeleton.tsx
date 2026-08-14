import React from "react";

function Bone({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-xl bg-[var(--clinical-skeleton,var(--clinical-surface-2))] motion-reduce:animate-none ${className}`}
    />
  );
}

export function PortalContentSkeleton({ variant = "list" }: { variant?: "dashboard" | "list" }) {
  const dashboard = variant === "dashboard";
  return (
    <section aria-busy="true" aria-live="polite" className="min-h-full space-y-5" role="status">
      <span className="sr-only">Loading portal content</span>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Bone className="h-8 w-56 max-w-[72vw]" />
          <Bone className="h-4 w-80 max-w-[82vw]" />
        </div>
        <div className="flex gap-2">
          <Bone className="h-11 w-24" />
          <Bone className="h-11 w-32" />
        </div>
      </div>

      <div className={`grid grid-cols-2 gap-3 ${dashboard ? "lg:grid-cols-4" : "sm:grid-cols-4"}`}>
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="rounded-2xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
            <Bone className="h-3 w-20" />
            <Bone className="mt-4 h-8 w-14" />
          </div>
        ))}
      </div>

      {dashboard ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 rounded-2xl border p-4 lg:col-span-2" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
            <Bone className="h-5 w-40" />
            <Bone className="h-52 w-full" />
          </div>
          <div className="space-y-3 rounded-2xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
            <Bone className="h-5 w-32" />
            {Array.from({ length: 4 }, (_, index) => <Bone key={index} className="h-14 w-full" />)}
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 rounded-2xl border p-3 sm:flex-row" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
            <Bone className="h-11 min-w-0 flex-1" />
            <Bone className="h-11 w-full sm:w-44" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex items-center gap-3 rounded-2xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                <Bone className="h-11 w-11 shrink-0" />
                <div className="min-w-0 flex-1 space-y-2"><Bone className="h-4 w-44 max-w-full" /><Bone className="h-3 w-72 max-w-[80%]" /></div>
                <Bone className="hidden h-9 w-24 sm:block" />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function PortalShellSkeleton() {
  return (
    <div aria-busy="true" className="flex min-h-screen bg-[var(--clinical-ground)] text-[var(--clinical-ink)]" role="status">
      <span className="sr-only">Loading your portal</span>
      <aside className="hidden w-60 shrink-0 border-r p-4 md:block" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
        <div className="flex items-center gap-3 border-b pb-5" style={{ borderColor: "var(--clinical-line)" }}><Bone className="h-10 w-10" /><div className="flex-1 space-y-2"><Bone className="h-4 w-24" /><Bone className="h-3 w-32" /></div></div>
        <Bone className="mt-5 h-11 w-full" />
        <div className="mt-6 space-y-3">{Array.from({ length: 9 }, (_, index) => <Bone key={index} className="h-11 w-full" />)}</div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex h-20 items-center justify-between border-b px-4 sm:px-6" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
          <div className="flex items-center gap-3"><Bone className="h-10 w-10 md:hidden" /><Bone className="h-5 w-36" /></div>
          <div className="flex items-center gap-3"><Bone className="hidden h-10 w-40 sm:block" /><Bone className="h-10 w-10 rounded-full" /></div>
        </header>
        <main className="p-4 pb-24 sm:p-6 md:pb-6"><PortalContentSkeleton variant="dashboard" /></main>
      </div>
    </div>
  );
}
