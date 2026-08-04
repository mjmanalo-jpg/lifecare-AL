"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

/**
 * Renders a real, scannable barcode from a code value. 12-digit numeric values
 * render as UPC-A; anything else falls back to CODE128 (covers legacy codes).
 */
export default function Barcode({
  value,
  height = 56,
  width = 2,
  displayValue = true,
  className,
}: {
  value: string;
  height?: number;
  width?: number;
  displayValue?: boolean;
  className?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !value) return;
    const isUpcA = /^\d{12}$/.test(value);
    try {
      JsBarcode(el, value, {
        format: isUpcA ? "UPC" : "CODE128",
        width,
        height,
        displayValue,
        fontSize: 14,
        margin: 6,
        background: "#ffffff",
        lineColor: "#111111",
      });
    } catch {
      // Invalid value for the chosen symbology — clear the element.
      while (el.firstChild) el.removeChild(el.firstChild);
    }
  }, [value, height, width, displayValue]);

  if (!value) return null;
  return <svg ref={ref} className={className} aria-label={`Barcode ${value}`} />;
}
