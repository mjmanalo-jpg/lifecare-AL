"use client";

import * as React from "react";
import { LogOut } from "lucide-react";

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

interface LogoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs when the user confirms sign-out. */
  onConfirm: () => void;
}

/**
 * Sign-out confirmation — shadcn/radix AlertDialog styled to match the
 * HeroUI "accent" AlertDialog example (soft accent icon, heading, body,
 * Stay Signed In / Sign Out).
 */
export default function LogoutDialog({ open, onOpenChange, onConfirm }: LogoutDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <span className="mb-1 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary sm:mx-0 mx-auto">
            <LogOut className="size-5" />
          </span>
          <AlertDialogTitle>Sign out of your account?</AlertDialogTitle>
          <AlertDialogDescription>
            You&apos;ll need to sign in again to access your account. Any unsaved changes will be
            lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay Signed In</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Sign Out</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
