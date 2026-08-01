"use client";

import * as React from "react";
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Global, imperative shadcn toast host.
//
// Unlike the per-component useToast() hook, this exposes a module-level
// `pushGlobalToast(...)` callable from anywhere (e.g. the SweetAlert2 drop-in
// in @/lib/swal). Mount <GlobalToaster /> exactly once, high in the tree
// (root layout). Success/error/warning/info notifications route here.
// ─────────────────────────────────────────────────────────────

export type GlobalToastVariant = "success" | "error" | "warning" | "info";

export interface GlobalToastItem {
  id: number;
  variant: GlobalToastVariant;
  title: string;
  description?: string;
}

let counter = 0;
let items: GlobalToastItem[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getSnapshot() {
  return items;
}

const TTL: Record<GlobalToastVariant, number> = {
  success: 2800,
  info: 3200,
  warning: 4200,
  error: 5600,
};

export function pushGlobalToast(variant: GlobalToastVariant, title: string, description?: string): number {
  const id = ++counter;
  items = [...items, { id, variant, title: title || "", description: description || undefined }];
  emit();
  if (typeof window !== "undefined") {
    window.setTimeout(() => dismissGlobalToast(id), TTL[variant]);
  }
  return id;
}

export function dismissGlobalToast(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

const META: Record<GlobalToastVariant, { icon: typeof CheckCircle2; iconClass: string; ring: string }> = {
  success: { icon: CheckCircle2, iconClass: "text-emerald-500", ring: "border-l-emerald-500" },
  error: { icon: AlertCircle, iconClass: "text-destructive", ring: "border-l-destructive" },
  warning: { icon: AlertTriangle, iconClass: "text-amber-500", ring: "border-l-amber-500" },
  info: { icon: Info, iconClass: "text-blue-500", ring: "border-l-blue-500" },
};

function ToastCard({ item }: { item: GlobalToastItem }) {
  const meta = META[item.variant];
  const Icon = meta.icon;
  return (
    <div
      role={item.variant === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-l-4 border-border bg-background p-4",
        "shadow-lg shadow-black/10 animate-in slide-in-from-right-full fade-in-0 duration-300",
        meta.ring,
      )}
    >
      <Icon className={cn("mt-0.5 size-5 shrink-0", meta.iconClass)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{item.title}</p>
        {item.description && <p className="mt-0.5 text-sm text-muted-foreground break-words">{item.description}</p>}
      </div>
      <button
        type="button"
        onClick={() => dismissGlobalToast(item.id)}
        aria-label="Dismiss"
        className="shrink-0 rounded-lg p-1 text-muted-foreground/70 outline-offset-2 transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function GlobalToaster() {
  const toasts = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} item={t} />
      ))}
    </div>
  );
}
