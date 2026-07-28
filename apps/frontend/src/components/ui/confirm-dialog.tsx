"use client";

import * as React from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  /** Use the destructive (red) button for the confirm action. */
  destructive?: boolean;
}

/**
 * Promise-based confirm dialog built on the shadcn AlertDialog — a drop-in
 * replacement for `await Swal.fire({ showCancelButton: true })`.
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *   if (!(await confirm({ title: "Delete?", destructive: true }))) return;
 *   ...
 *   return (<>{confirmDialog}</>);
 */
export function useConfirm() {
  const [state, setState] = React.useState<{
    opts: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  const confirm = React.useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ opts, resolve })),
    [],
  );

  const settle = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };

  const confirmDialog = (
    <AlertDialog
      open={!!state}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state?.opts.title ?? ""}</AlertDialogTitle>
          {state?.opts.description && (
            <AlertDialogDescription>{state.opts.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>
            {state?.opts.cancelText ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => settle(true)}
            className={state?.opts.destructive ? buttonVariants({ variant: "destructive" }) : undefined}
          >
            {state?.opts.confirmText ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, confirmDialog };
}
