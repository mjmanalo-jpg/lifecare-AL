"use client";

import * as React from "react";
import { AlertTriangle, HelpCircle, Info, CheckCircle2, ShieldAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Global, imperative shadcn confirm dialog.
//
// `openGlobalConfirm(opts)` returns a Promise<{confirmed}> so it can back the
// SweetAlert2 drop-in's `Swal.fire({ showCancelButton: true })` path without
// rewriting call sites. Mount <GlobalConfirmDialog /> once in the root layout.
// ─────────────────────────────────────────────────────────────

export type ConfirmVariant = "default" | "danger" | "warning" | "info" | "success";

export interface GlobalConfirmOptions {
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
}

export interface GlobalConfirmResult {
  confirmed: boolean;
}

type State = { opts: GlobalConfirmOptions; resolve: (r: GlobalConfirmResult) => void } | null;

let state: State = null;
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
  return state;
}

export function openGlobalConfirm(opts: GlobalConfirmOptions): Promise<GlobalConfirmResult> {
  return new Promise((resolve) => {
    // If one is already open, resolve it as cancelled before replacing.
    if (state) state.resolve({ confirmed: false });
    state = { opts, resolve };
    emit();
  });
}

const VARIANT: Record<
  ConfirmVariant,
  { Icon: typeof HelpCircle; tint: string; confirm: "default" | "destructive" }
> = {
  default: { Icon: HelpCircle, tint: "bg-[#22577a]/10 text-[#22577a] ring-[#22577a]/10", confirm: "default" },
  info: { Icon: Info, tint: "bg-[#22577a]/10 text-[#22577a] ring-[#22577a]/10", confirm: "default" },
  warning: { Icon: AlertTriangle, tint: "bg-[#8f6410]/10 text-[#8f6410] ring-[#8f6410]/10", confirm: "default" },
  danger: { Icon: ShieldAlert, tint: "bg-destructive/10 text-destructive ring-destructive/10", confirm: "destructive" },
  success: { Icon: CheckCircle2, tint: "bg-[#277a55]/10 text-[#277a55] ring-[#277a55]/10", confirm: "default" },
};

export function GlobalConfirmDialog() {
  const current = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const open = !!current;
  const opts = current?.opts ?? {};
  const meta = VARIANT[opts.variant ?? "default"];
  const Icon = meta.Icon;

  const settle = (confirmed: boolean) => {
    current?.resolve({ confirmed });
    state = null;
    emit();
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) settle(false); }}>
      <AlertDialogContent className="sm:max-w-[420px] sm:rounded-2xl">
        <div className="flex flex-col items-center gap-4 pt-1 text-center">
          <div className={cn("flex size-14 items-center justify-center rounded-full ring-8", meta.tint)}>
            <Icon className="size-7" />
          </div>
          <div className="space-y-1.5">
            <AlertDialogTitle className="text-xl">{opts.title ?? "Are you sure?"}</AlertDialogTitle>
            {opts.description && (
              <AlertDialogDescription className="text-[13px] leading-relaxed">
                {opts.description}
              </AlertDialogDescription>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-col-reverse gap-2 sm:grid sm:grid-cols-2">
          <button
            type="button"
            className={cn(buttonVariants({ variant: "secondary" }), "h-10")}
            onClick={() => settle(false)}
          >
            {opts.cancelText ?? "Cancel"}
          </button>
          <button
            type="button"
            autoFocus
            className={cn(buttonVariants({ variant: meta.confirm }), "h-10")}
            onClick={() => settle(true)}
          >
            {opts.confirmText ?? "Confirm"}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
