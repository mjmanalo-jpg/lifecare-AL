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

interface CompleteTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing photo proof URL / current charge, if any. */
  defaultPhotoUrl?: string;
  defaultCharge?: number;
  onSubmit: (photo: string, charge: number) => void;
}

// Read a device photo, downscale it (max 1000px, JPEG q0.7) so the payload stays small.
const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1000;
        let w = img.width;
        let h = img.height;
        if (w > max || h > max) {
          const s = max / Math.max(w, h);
          w = Math.round(w * s);
          h = Math.round(h * s);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });

export default function CompleteTicketDialog({
  open,
  onOpenChange,
  defaultPhotoUrl = "",
  defaultCharge = 0,
  onSubmit,
}: CompleteTicketDialogProps) {
  const isHttpUrl = /^https?:/.test(defaultPhotoUrl);
  const [photoData, setPhotoData] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [charge, setCharge] = React.useState("");
  const [preview, setPreview] = React.useState("");

  // Reset to the ticket's current values whenever the dialog is (re)opened.
  React.useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhotoData(defaultPhotoUrl && !isHttpUrl ? defaultPhotoUrl : "");
    setUrl(isHttpUrl ? defaultPhotoUrl : "");
    setCharge(defaultCharge ? String(defaultCharge) : "");
    setPreview(defaultPhotoUrl || "");
  }, [open, defaultPhotoUrl, defaultCharge, isHttpUrl]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await fileToDataUrl(file);
    setPhotoData(data);
    setPreview(data);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const photo = photoData || url.trim();
    onSubmit(photo, Number(charge) || 0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete with Photo Proof</DialogTitle>
          <DialogDescription>
            Attach a photo of the finished work and the final billing.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="ticket-photo-file">Photo of finished work</Label>
            <Input
              id="ticket-photo-file"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFile}
            />
          </div>

          {preview && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={preview}
              alt="Work proof preview"
              className="mx-auto max-h-36 rounded-lg border border-border object-contain"
            />
          )}

          <div className="grid gap-2">
            <Label htmlFor="ticket-photo-url">…or paste a photo URL</Label>
            <Input
              id="ticket-photo-url"
              type="url"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ticket-charge">Billable charge (₱, 0 = free)</Label>
            <Input
              id="ticket-charge"
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={charge}
              onChange={(e) => setCharge(e.target.value)}
            />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit">Complete Ticket</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
