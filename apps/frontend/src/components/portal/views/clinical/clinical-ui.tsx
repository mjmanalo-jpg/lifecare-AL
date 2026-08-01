import * as React from "react";

// ─────────────────────────────────────────────────────────────
// SLMS "clinical-editorial" design kit — matches the Feature Overview PDF:
// warm sage ground, deep slate-teal panels, coral accents, amber/green status,
// uppercase letter-spaced micro-labels. Shared so every clinical screen is
// consistent and the look can spread quickly.
// ─────────────────────────────────────────────────────────────

export const CLINICAL = {
  ground: "#E8E9E1",
  panel: "#2E4A48",
  panelSoft: "#3C5A55",
  coral: "#C0573F",
  amber: "#C39A3E",
  green: "#7E9B6F",
  ink: "#2B2B27",
  muted: "#8A8D82",
  line: "#D6D8CD",
};

// Status → pill classes, keyed by the PDF's colour language.
const PILL: Record<string, string> = {
  // teal — given / approved / confirmed / normal / active / responded / phone
  GIVEN: "bg-[#2E4A48] text-white", APPROVED: "bg-[#2E4A48] text-white", CONFIRMED: "bg-[#2E4A48] text-white",
  NORMAL: "bg-[#2E4A48] text-white", ACTIVE: "bg-[#2E4A48] text-white", RESPONDED: "bg-[#2E4A48] text-white",
  SPECIALIST: "bg-[#2E4A48] text-white", PHONE: "bg-[#2E4A48] text-white", SCHEDULED: "bg-[#2E4A48] text-white",
  // green — completed / done / closed / follow_up
  COMPLETED: "bg-[#7E9B6F] text-white", DONE: "bg-[#7E9B6F] text-white", CLOSED: "bg-[#7E9B6F] text-white",
  FOLLOW_UP: "bg-[#7E9B6F] text-white",
  // coral — refused / critical / overdue / expired / emergency / rejected / cancelled / in_person
  REFUSED: "bg-[#C0573F] text-white", CRITICAL: "bg-[#C0573F] text-white", OVERDUE: "bg-[#C0573F] text-white",
  EXPIRED: "bg-[#C0573F] text-white", EMERGENCY: "bg-[#C0573F] text-white", REJECTED: "bg-[#C0573F] text-white",
  CANCELLED: "bg-[#B4735F] text-white", IN_PERSON: "bg-[#C0573F] text-white",
  OUT_OF_STOCK: "bg-[#9E3B2A] text-white",
  // amber — pending / in progress / low / urgent / warning / expiring / open / written
  PENDING: "bg-[#C39A3E] text-white", PENDING_APPROVAL: "bg-[#C39A3E] text-white", IN_PROGRESS: "bg-[#C39A3E] text-white",
  REQUESTED: "bg-[#C39A3E] text-white", LOW: "bg-[#C39A3E] text-white", URGENT: "bg-[#C39A3E] text-white",
  WARNING: "bg-[#C39A3E] text-white", EXPIRING: "bg-[#C39A3E] text-white", OPEN: "bg-[#C39A3E] text-white",
  WRITTEN: "bg-[#C39A3E] text-white",
  // muted teal — held / telemedicine
  HELD: "bg-[#5B7A70] text-white", TELEMEDICINE: "bg-[#5B7A70] text-white",
  // grey — missed / routine / info / draft
  MISSED: "bg-[#D8DAD0] text-[#5A5D53]", ROUTINE: "bg-[#D8DAD0] text-[#5A5D53]",
  INFO: "bg-[#D8DAD0] text-[#5A5D53]", DRAFT: "bg-[#D8DAD0] text-[#5A5D53]", NORMAL_PRIORITY: "bg-[#D8DAD0] text-[#5A5D53]",
};

export function pillClass(status: string): string {
  const k = String(status ?? "").toUpperCase().replace(/[\s-]/g, "_");
  return PILL[k] ?? "bg-[#D8DAD0] text-[#5A5D53]";
}

export function StatusPill({ status, className = "", children }: { status: string; className?: string; children?: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-[0.05em] ${pillClass(status)} ${className}`}>
      {children ?? String(status ?? "").replace(/_/g, " ")}
    </span>
  );
}

export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[11px] font-bold uppercase tracking-[0.16em] text-[#C0573F] ${className}`}>{children}</p>;
}

export function MicroLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8A8D82] ${className}`}>{children}</p>;
}

/** Page heading in the clinical-editorial style (ink title + coral eyebrow, no gradient). */
export function ClinicalHeader({ eyebrow, title, subtitle, right }: { eyebrow?: string; title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
      <div>
        {eyebrow && <Eyebrow className="mb-1.5">{eyebrow}</Eyebrow>}
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#2B2B27]" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>{title}</h1>
        {subtitle && <p className="text-sm text-[#6B6E63] mt-1">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

/** White card with an optional coloured top rule (teal / coral / amber / green). */
export function ClinicalCard({ top, className = "", children }: { top?: "teal" | "coral" | "amber" | "green" | "none"; className?: string; children: React.ReactNode }) {
  const rule = { teal: "#2E4A48", coral: "#C0573F", amber: "#C39A3E", green: "#7E9B6F", none: "transparent" }[top ?? "none"];
  const hasTop = Boolean(top && top !== "none");
  // Longhand only — mixing `border` shorthand with `borderTop` warns in React.
  const style: React.CSSProperties = { borderStyle: "solid", borderColor: "#E1E3D9", borderWidth: 1 };
  if (hasTop) { style.borderTopWidth = 3; style.borderTopColor = rule; }
  return (
    <div className={`bg-white rounded-lg shadow-sm shadow-black/[0.03] ${className}`} style={style}>
      {children}
    </div>
  );
}
