// Shared structured-PDF builder for the clinical report exports (Progress Report,
// Care History, 24-Hour Routine, Care Task). Produces a clean, self-contained A4
// document — no page chrome, unlike window.print(). Text is kept ASCII / Latin-1
// so jsPDF's built-in helvetica renders it (no subscripts / arrows).

import { jsPDF } from "jspdf";
import { LIFECARE_LOGO_FILE } from "./lifecare/brand";

// Preload the LifeCare header logo once (same-origin PNG) so createReport() can
// stamp it into the header synchronously. Boards import this module on mount, so
// by the time the user clicks "Export PDF" the image is decoded and cached; if it
// somehow isn't ready yet the report simply prints without the logo that once.
interface LogoImg { img: HTMLImageElement; ratio: number }
let cachedLogo: LogoImg | null = null;
function preloadLogo() {
  if (typeof window === "undefined" || cachedLogo) return;
  const img = new Image();
  img.onload = () => { cachedLogo = { img, ratio: img.naturalWidth / img.naturalHeight || 3.5 }; };
  img.src = LIFECARE_LOGO_FILE;
}
preloadLogo();

/** Draw the cached LifeCare logo top-right of the current page (no-op until loaded). */
export function stampLifecareLogo(doc: jsPDF, pageW: number, M = 40, topY = 30, h = 26) {
  preloadLogo();
  if (!cachedLogo) return;
  const w = h * cachedLogo.ratio;
  try { doc.addImage(cachedLogo.img, "PNG", pageW - M - w, topY, w, h); } catch { /* logo optional */ }
}

interface TextOpts { x?: number; size?: number; bold?: boolean; color?: number }
export interface PdfReport {
  doc: jsPDF;
  M: number;
  pageW: number;
  /** Title + optional subtitle + emphasis lines (first line larger/bold). */
  header(title: string, subtitle: string, lines?: string[]): void;
  /** Underlined section heading. */
  heading(title: string): void;
  /** One line of text; advances the cursor. */
  text(t: string, opts?: TextOpts): void;
  /** Word-wrapped paragraph across the content width. */
  wrapped(t: string, opts?: TextOpts): void;
  /** 3-up label/value metric grid. */
  metrics(pairs: [string, string][]): void;
  /** Column table with a repeating header on page breaks. */
  table(cols: readonly number[], headers: string[], rows: (string | number)[][], opts?: { badIdx?: number; badValues?: string[] }): void;
  gap(h: number): void;
  save(name: string): void;
}

export function createReport(): PdfReport {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 40;
  const CW = pageW - M * 2;
  let y = 50;

  const font = (size: number, bold = false, color = 60) =>
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size).setTextColor(color);
  // Returns true when a page break happened (so table callers can re-print headers).
  const ensure = (h: number) => { if (y + h > pageH - M) { doc.addPage(); y = M; return true; } return false; };

  const text: PdfReport["text"] = (t, o = {}) => {
    const { x = M, size = 10, bold = false, color = 60 } = o;
    ensure(size + 4); font(size, bold, color); doc.text(t, x, y); y += size + 4;
  };

  const wrapped: PdfReport["wrapped"] = (t, o = {}) => {
    const { x = M, size = 9, bold = false, color = 80 } = o;
    font(size, bold, color);
    (doc.splitTextToSize(t, CW - (x - M)) as string[]).forEach((ln) => { ensure(size + 2); doc.text(ln, x, y); y += size + 2; });
  };

  const header: PdfReport["header"] = (title, subtitle, lines = []) => {
    stampLifecareLogo(doc, pageW, M);
    font(16, true, 20); doc.text(title, M, y); y += 20;
    if (subtitle) { font(9, false, 120); doc.text(subtitle, M, y); y += 16; }
    lines.forEach((l, i) => { ensure(16); font(i === 0 ? 13 : 9.5, i === 0, i === 0 ? 30 : 70); doc.text(l, M, y); y += i === 0 ? 16 : 13; });
  };

  const heading: PdfReport["heading"] = (title) => {
    ensure(34); y += 12; font(12, true, 20); doc.text(title, M, y); y += 6;
    doc.setDrawColor(210).line(M, y, pageW - M, y); y += 12;
  };

  const metrics: PdfReport["metrics"] = (pairs) => {
    const colW = CW / 3;
    pairs.forEach((p, i) => {
      const col = i % 3, x = M + col * colW;
      if (col === 0) ensure(28);
      font(7.5, false, 130); doc.text(p[0], x, y);
      font(11, true, 30); doc.text(p[1], x, y + 12);
      if (col === 2 || i === pairs.length - 1) y += 27;
    });
  };

  const table: PdfReport["table"] = (cols, headers, rows, opts = {}) => {
    const bads = opts.badValues ?? ["Abnormal", "Missing", "Overdue", "Blocked"];
    const printHeader = () => { font(8, true, 120); headers.forEach((h, i) => doc.text(h, cols[i], y)); y += 4; doc.setDrawColor(230).line(M, y, pageW - M, y); y += 11; };
    ensure(24); printHeader();
    rows.forEach((cells) => {
      if (ensure(13)) printHeader();
      cells.forEach((c, i) => {
        const str = String(c ?? "");
        const bad = opts.badIdx === i && bads.includes(str);
        font(8.5, bad, bad ? 200 : i === 0 ? 40 : 70);
        doc.text(str.length > 48 ? str.slice(0, 47) + "…" : str, cols[i], y);
      });
      y += 13;
    });
  };

  return { doc, M, pageW, header, heading, text, wrapped, metrics, table, gap: (h) => { y += h; }, save: (name) => doc.save(name) };
}
