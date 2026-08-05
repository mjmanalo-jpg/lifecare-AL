"use client";

import { useEffect } from "react";
import Barcode from "@/components/portal/Barcode";

export interface BarcodeLabel {
  code: string;
  itemName: string;
  category?: string;
  location?: string;
  sub?: string;
}

/**
 * Off-screen, print-only sheet of barcode labels. While mounted it stays parked
 * off the left edge so it never shows on screen; a print stylesheet hides the
 * rest of the app and reveals just this sheet. On mount it waits for the
 * barcodes to paint, fires window.print(), then calls onDone after printing.
 *
 * Works with the browser print dialog, so "Save as PDF" produces the PDF and
 * a physical/label printer prints the same sheet.
 */
export default function BarcodeLabelSheet({
  labels,
  title = "Inventory Barcode Labels",
  onDone,
}: {
  labels: BarcodeLabel[];
  title?: string;
  onDone: () => void;
}) {
  useEffect(() => {
    if (!labels.length) { onDone(); return; }
    const after = () => onDone();
    window.addEventListener("afterprint", after);
    // Two frames so JsBarcode has drawn every SVG before the dialog opens.
    const r1 = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        try { window.print(); } catch { onDone(); }
      }),
    );
    return () => {
      cancelAnimationFrame(r1);
      window.removeEventListener("afterprint", after);
    };
  }, [labels, onDone]);

  return (
    <div id="barcode-print-sheet" aria-hidden>
      <style>{`
        #barcode-print-sheet {
          position: fixed; left: -99999px; top: 0;
          width: 210mm; background: #fff; color: #111;
          font-family: ui-sans-serif, system-ui, sans-serif;
        }
        #barcode-print-sheet .bl-head { padding: 4mm 0 3mm; font-size: 12px; font-weight: 700; }
        #barcode-print-sheet .bl-grid {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm;
        }
        #barcode-print-sheet .bl-cell {
          border: 1px solid #d6d8cd; border-radius: 6px; padding: 3mm 2mm;
          text-align: center; break-inside: avoid; page-break-inside: avoid;
        }
        #barcode-print-sheet .bl-name { font-size: 12px; font-weight: 700; line-height: 1.15; }
        #barcode-print-sheet .bl-meta { font-size: 9px; color: #6b7280; margin-top: 1mm; }
        @media print {
          body * { visibility: hidden !important; }
          #barcode-print-sheet, #barcode-print-sheet * { visibility: visible !important; }
          #barcode-print-sheet { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; }
          @page { size: A4 portrait; margin: 10mm; }
        }
      `}</style>
      <div className="bl-head">{title} — {labels.length} label{labels.length === 1 ? "" : "s"}</div>
      <div className="bl-grid">
        {labels.map((l, i) => (
          <div key={`${l.code}-${i}`} className="bl-cell">
            <div className="bl-name">{l.itemName}</div>
            {(l.category || l.location) && (
              <div className="bl-meta">{[l.category, l.location].filter(Boolean).join(" · ")}</div>
            )}
            <div style={{ display: "flex", justifyContent: "center", marginTop: "1.5mm" }}>
              <Barcode value={l.code} height={44} width={1.5} />
            </div>
            {l.sub && <div className="bl-meta">{l.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
