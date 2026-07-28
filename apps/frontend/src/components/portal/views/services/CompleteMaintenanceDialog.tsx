"use client";

import * as React from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CompleteMaintenanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entryTitle?: string;
  defaultCost?: number;
  confirmLabel?: string;
  onSubmit: (cost: number) => void;
}

export default function CompleteMaintenanceDialog({
  open,
  onOpenChange,
  entryTitle,
  defaultCost = 0,
  confirmLabel = "Complete",
  onSubmit,
}: CompleteMaintenanceDialogProps) {
  const [cost, setCost] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCost(defaultCost ? String(defaultCost) : "");
  }, [open, defaultCost]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(Number(cost) || 0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete Maintenance</DialogTitle>
          <DialogDescription>
            {entryTitle ? `"${entryTitle}" — enter the final cost.` : "Enter the final cost."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="maint-cost">Cost (₱)</Label>
            <Input
              id="maint-cost"
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              autoFocus
            />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit">{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
