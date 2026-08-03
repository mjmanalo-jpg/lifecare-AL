"use client";

import { useEffect, useState } from "react";
import { QrCode, X, FileDown, ExternalLink } from "lucide-react";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";

/**
 * Shows a resident's QR code (the thing staff scan). Scanning it opens the full
 * care card at /rcard/<id>. Offers a "QR only" PDF for printing a label/tag.
 */
export default function ResidentQRModal({
  open, onClose, residentId, name, room,
}: { open: boolean; onClose: () => void; residentId: string; name: string; room?: string }) {
  const [qrData, setQrData] = useState("");
  const [cardUrl, setCardUrl] = useState("");

  useEffect(() => {
    if (!open || !residentId) return;
    const url = `${window.location.origin}/rcard/${residentId}`;
    setCardUrl(url);
    QRCode.toDataURL(url, { width: 512, margin: 1 }).then(setQrData).catch(() => setQrData(""));
  }, [open, residentId]);

  const slug = (name || "resident").toLowerCase().replace(/\s+/g, "-");

  const downloadQrPdf = () => {
    if (!qrData) return;
    const doc = new jsPDF({ unit: "pt", format: [280, 340] });
    doc.addImage(qrData, "PNG", 40, 30, 200, 200);
    doc.setFont("helvetica", "bold").setFontSize(15).text(name || "Resident", 140, 258, { align: "center" });
    if (room) doc.setFont("helvetica", "normal").setFontSize(11).setTextColor(90).text(`Room ${room}`, 140, 278, { align: "center" });
    doc.setFontSize(9).setTextColor(130).text("Scan for the resident care card", 140, 300, { align: "center" });
    doc.save(`${slug}-qr.pdf`);
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="bg-[#2E4A48] text-white px-5 py-4 flex items-center justify-between">
          <h3 className="font-bold text-lg flex items-center gap-2"><QrCode className="w-5 h-5" /> Resident QR</h3>
          <button onClick={onClose} className="p-1 hover:bg-white/15 rounded"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 flex flex-col items-center text-center gap-3">
          {qrData ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={qrData} alt="Resident QR code" width={220} height={220} className="rounded-lg border border-gray-200" />
          ) : (
            <div className="w-[220px] h-[220px] bg-gray-100 rounded-lg animate-pulse" />
          )}
          <div>
            <p className="font-bold text-gray-900">{name || "Resident"}</p>
            {room && <p className="text-sm text-gray-500">Room {room}</p>}
          </div>
          <p className="text-xs text-gray-500">Scan this code to open the resident&apos;s full care card.</p>
          <div className="flex flex-col sm:flex-row gap-2 w-full mt-1">
            <button onClick={downloadQrPdf} disabled={!qrData} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#2E4A48] text-white text-sm font-semibold hover:bg-[#25403D] disabled:opacity-50 transition">
              <FileDown className="w-4 h-4" /> QR PDF
            </button>
            <a href={cardUrl || `/rcard/${residentId}`} target="_blank" rel="noopener noreferrer" className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition">
              <ExternalLink className="w-4 h-4" /> Open card
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
