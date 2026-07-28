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

interface StartWorkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Context line, e.g. "Repairs — John Doe (Room 302)". */
  context?: string;
  defaultWorker?: string;
  onSubmit: (worker: string) => void;
}

export default function StartWorkDialog({
  open,
  onOpenChange,
  context,
  defaultWorker = "",
  onSubmit,
}: StartWorkDialogProps) {
  const [worker, setWorker] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWorker(defaultWorker);
  }, [open, defaultWorker]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(worker.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start Work Order</DialogTitle>
          {context && <DialogDescription>{context}</DialogDescription>}
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="start-worker">Staff member working the ticket</Label>
            <Input
              id="start-worker"
              placeholder="Staff member name"
              value={worker}
              onChange={(e) => setWorker(e.target.value)}
              autoFocus
            />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit">Start Work</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
