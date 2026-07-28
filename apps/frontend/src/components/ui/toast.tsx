"use client";

import * as React from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

import { cn } from "@/lib/utils";

export type ToastVariant = "success" | "error";

export interface ToastItem {
  id: number;
  variant: ToastVariant;
  title: string;
  description?: string;
}

let counter = 0;

/**
 * Lightweight shadcn-styled toast system — replaces SweetAlert2 success/error
 * popups. `toast("success", ...)` auto-dismisses; errors linger longer.
 */
export function useToast() {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    (variant: ToastVariant, title: string, description?: string) => {
      const id = ++counter;
      setToasts((prev) => [...prev, { id, variant, title, description }]);
      const ttl = variant === "success" ? 2600 : 5200;
      setTimeout(() => dismiss(id), ttl);
      return id;
    },
    [dismiss],
  );

  return { toasts, toast, dismiss };
}

const VARIANT_META: Record<
  ToastVariant,
  { icon: typeof CheckCircle2; iconClass: string; ring: string }
> = {
  success: { icon: CheckCircle2, iconClass: "text-green-600", ring: "border-l-green-500" },
  error: { icon: AlertCircle, iconClass: "text-destructive", ring: "border-l-destructive" },
};

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const meta = VARIANT_META[toast.variant];
  const Icon = meta.icon;
  return (
    <div
      role={toast.variant === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-l-4 border-border bg-background p-4 shadow-lg shadow-black/5",
        "data-[state=open]:animate-in data-[state=open]:slide-in-from-right-full data-[state=open]:fade-in-0",
        meta.ring,
      )}
      data-state="open"
    >
      <Icon className={cn("mt-0.5 size-5 shrink-0", meta.iconClass)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{toast.title}</p>
        {toast.description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{toast.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-lg p-1 text-muted-foreground/70 outline-offset-2 transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70"
        aria-label="Dismiss"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function Toaster({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[120] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}
