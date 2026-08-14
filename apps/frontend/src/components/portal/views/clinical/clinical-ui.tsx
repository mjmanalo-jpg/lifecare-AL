import * as React from "react";
import { X, Search } from "lucide-react";

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
  // teal — given / approved / confirmed / normal / active / responded / acknowledged / phone
  GIVEN: "bg-[#2E4A48] text-white", APPROVED: "bg-[#2E4A48] text-white", CONFIRMED: "bg-[#2E4A48] text-white",
  NORMAL: "bg-[#2E4A48] text-white", ACTIVE: "bg-[#2E4A48] text-white", RESPONDED: "bg-[#2E4A48] text-white",
  ACKNOWLEDGED: "bg-[#2E4A48] text-white",
  SPECIALIST: "bg-[#2E4A48] text-white", PHONE: "bg-[#2E4A48] text-white", SCHEDULED: "bg-[#2E4A48] text-white",
  // green — completed / done / closed / resolved / follow_up
  COMPLETED: "bg-[#7E9B6F] text-white", DONE: "bg-[#7E9B6F] text-white", CLOSED: "bg-[#7E9B6F] text-white",
  RESOLVED: "bg-[#7E9B6F] text-white", FOLLOW_UP: "bg-[#7E9B6F] text-white",
  // coral — refused / critical / overdue / expired / emergency / escalated / rejected / cancelled / in_person
  REFUSED: "bg-[#C0573F] text-white", CRITICAL: "bg-[#C0573F] text-white", OVERDUE: "bg-[#C0573F] text-white",
  EXPIRED: "bg-[#C0573F] text-white", EMERGENCY: "bg-[#C0573F] text-white", REJECTED: "bg-[#C0573F] text-white",
  ESCALATED: "bg-[#C0573F] text-white",
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
  return <p className={`text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--clinical-coral)] ${className}`}>{children}</p>;
}

export function MicroLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--clinical-muted)] ${className}`}>{children}</p>;
}

/** Display face for headings/metrics — Inter (the redesigned clinical world is
 *  all sans; SERIF stays exported as a legacy alias so older imports keep working). */
export const DISPLAY = "Inter, system-ui, -apple-system, sans-serif";
export const SERIF = DISPLAY;

/** Page heading: strong sans title + muted subtitle, action on the right. */
export function ClinicalHeader({ title, subtitle, right }: { eyebrow?: string; title?: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {title && <h1 className="text-2xl font-bold tracking-[-0.02em] text-[var(--clinical-ink)] sm:text-[1.75rem]" style={{ fontFamily: DISPLAY }}>{title}</h1>}
        {subtitle && <p className="mt-1.5 max-w-3xl text-sm leading-6 text-[var(--clinical-muted)]">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/** Card with an optional coloured top rule (teal / coral / amber / green). Token-backed so it themes light/dark. */
export function ClinicalCard({ top, className = "", children }: { top?: "teal" | "coral" | "amber" | "green" | "none"; className?: string; children: React.ReactNode }) {
  const rule = { teal: "var(--clinical-panel)", coral: "var(--clinical-coral)", amber: "var(--clinical-amber)", green: "var(--clinical-green)", none: "transparent" }[top ?? "none"];
  const hasTop = Boolean(top && top !== "none");
  // Longhand only — mixing `border` shorthand with `borderTop` warns in React.
  const style: React.CSSProperties = { borderStyle: "solid", borderColor: "var(--clinical-line)", borderWidth: 1, backgroundColor: "var(--clinical-surface)" };
  if (hasTop) { style.borderTopWidth = 2; style.borderTopColor = rule; }
  return (
    <div className={`clinical-card rounded-xl ${className}`} style={{ ...style, boxShadow: "var(--clinical-shadow, 0 10px 28px -24px rgba(15, 23, 42, 0.45))" }}>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Shared action + state primitives — token-backed so every clinical
// board draws its buttons and its loading / empty / error states the
// same way instead of hand-rolling a slightly different version.
// ─────────────────────────────────────────────────────────────

type BtnVariant = "primary" | "accent" | "secondary" | "ghost" | "danger";
const BTN_BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--clinical-focus,var(--clinical-panel))] active:scale-[0.98]";
const BTN_VARIANT: Record<BtnVariant, string> = {
  // indigo — the standard primary action
  primary: "bg-[var(--clinical-panel)] text-white shadow-[0_8px_20px_-12px_rgba(0,0,0,0.8)] hover:bg-[var(--clinical-panel-hover,var(--clinical-panel))]",
  // accent == primary here: one confident indigo CTA, no competing accent colour
  accent: "bg-[var(--clinical-panel)] text-white shadow-[0_8px_20px_-12px_rgba(0,0,0,0.8)] hover:bg-[var(--clinical-panel-hover,var(--clinical-panel))]",
  secondary: "border border-[var(--clinical-line-strong)] bg-[var(--clinical-surface)] text-[var(--clinical-ink)] hover:bg-[var(--clinical-surface-raised,var(--clinical-surface-2))]",
  ghost: "text-[var(--clinical-ink-soft)] hover:bg-[var(--clinical-surface-2)]",
  danger: "bg-[var(--clinical-coral)] text-white shadow-sm hover:brightness-110",
};

export function ClinicalButton({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  const pad = size === "sm" ? "px-3 py-1.5" : "px-4 py-2.5";
  return <button type={type} className={`${BTN_BASE} ${pad} ${BTN_VARIANT[variant]} ${className}`} {...props} />;
}

/** Shimmer skeleton block for loading states. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-[var(--clinical-surface-2)] ${className}`} />;
}

/**
 * One place for the loading / error / empty branches so a board never shows
 * "no results" while it is actually still fetching. Renders children only when
 * there is real data to show.
 */
export function DataState({
  loading,
  error,
  empty,
  emptyTitle = "Nothing here yet",
  emptyHint,
  emptyAction,
  onRetry,
  skeletonRows = 4,
  children,
}: {
  loading?: boolean;
  error?: unknown;
  empty?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  emptyAction?: React.ReactNode;
  onRetry?: () => void;
  skeletonRows?: number;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="space-y-3" role="status" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading…</span>
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border p-8 text-center" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>
        <p className="text-sm font-semibold text-[var(--clinical-ink)]">We couldn&apos;t load this</p>
        <p className="mt-1 text-sm text-[var(--clinical-muted)]">{error instanceof Error ? error.message : "Something went wrong while fetching the latest data."}</p>
        {onRetry && (
          <ClinicalButton variant="secondary" size="sm" className="mt-4" onClick={onRetry}>Try again</ClinicalButton>
        )}
      </div>
    );
  }
  if (empty) {
    return (
      <div className="rounded-lg border p-10 text-center" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>
        <p className="text-base font-semibold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{emptyTitle}</p>
        {emptyHint && <p className="mx-auto mt-1.5 max-w-md text-sm text-[var(--clinical-muted)]">{emptyHint}</p>}
        {emptyAction && <div className="mt-4 flex justify-center">{emptyAction}</div>}
      </div>
    );
  }
  return <>{children}</>;
}

// ─────────────────────────────────────────────────────────────
// Shared control + layout primitives — one token set for every clinical
// board so grounds, inputs, search, stats, and MODALS are identical
// instead of hand-rolled (and inconsistently sized) per screen.
// ─────────────────────────────────────────────────────────────

/** Full-bleed clinical page ground every board sits on (replaces the
 *  hard-coded #F7F8FA that stranded a light ground in dark mode). */
export function ClinicalPage({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`-m-3 min-h-full bg-[var(--clinical-ground)] p-3 transition-colors duration-300 sm:-m-5 sm:p-5 lg:-m-7 lg:p-7 ${className}`}>{children}</div>;
}

/** Shared control classes (inputs, selects, textareas) — token-backed, dark-safe. */
export const controlClass =
  "w-full rounded-lg border border-[var(--clinical-line-strong)] bg-[var(--clinical-surface)] px-3 py-2.5 text-sm text-[var(--clinical-ink)] outline-none transition placeholder:text-[var(--clinical-muted)] focus:border-[var(--clinical-focus,var(--clinical-panel))] focus:ring-2 focus:ring-[var(--clinical-focus,var(--clinical-panel))]/20";

export function FieldLabel({ children, required, htmlFor }: { children: React.ReactNode; required?: boolean; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold text-[var(--clinical-ink)]">
      {children}{required && <span className="text-[var(--clinical-coral)]"> *</span>}
    </label>
  );
}

/** Labelled search box used across board list views. */
export function SearchInput({ value, onChange, placeholder = "Search…", className = "" }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--clinical-muted)]" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={`${controlClass} pl-10`} />
    </div>
  );
}

type StatAccent = "ink" | "teal" | "coral" | "amber" | "green";
/** Modern KPI card — uppercase micro-label over a large bold numeral, soft depth. */
export function StatCard({ value, label, accent = "ink" }: { value: React.ReactNode; label: string; accent?: StatAccent }) {
  const color = { ink: "var(--clinical-ink)", teal: "var(--clinical-panel)", coral: "var(--clinical-coral)", amber: "var(--clinical-amber)", green: "var(--clinical-green)" }[accent];
  return (
    <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">{label}</p>
      <p className="mt-1.5 text-[1.75rem] font-bold leading-none tabular-nums" style={{ color, fontFamily: DISPLAY }}>{value}</p>
    </div>
  );
}

/**
 * The one modal every board uses. Fixes the hand-rolled height/width drift:
 * a bottom sheet on phones, a sized centred dialog from `sm` up, with a sticky
 * header + footer and a single scrolling body. Escape and backdrop close it,
 * body scroll is locked while open, and it is labelled for screen readers.
 */
export function ClinicalModal({
  open, onClose, title, description, size = "md", footer, children,
}: {
  open: boolean; onClose: () => void; title: string; description?: string;
  size?: "sm" | "md" | "lg" | "xl"; footer?: React.ReactNode; children: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  const maxW = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-3xl" }[size];
  return (
    <div className="clinical-modal-backdrop fixed inset-0 z-50 flex items-end justify-center p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className={`clinical-modal-panel flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border sm:max-h-[85vh] sm:rounded-2xl ${maxW}`}
        style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line-strong)", boxShadow: "0 28px 80px -24px rgba(0, 0, 0, 0.9)" }}>
        <div className="flex flex-none items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--clinical-line)" }}>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{title}</h2>
            {description && <p className="mt-0.5 text-xs text-[var(--clinical-muted)]">{description}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="-mr-1.5 shrink-0 rounded-lg p-2 text-[var(--clinical-muted)] transition hover:bg-[var(--clinical-surface-2)] hover:text-[var(--clinical-ink)]"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 scrollbar-thin">{children}</div>
        {footer && <div className="flex flex-none flex-wrap items-center justify-end gap-2 border-t px-5 py-3.5" style={{ borderColor: "var(--clinical-line)" }}>{footer}</div>}
      </div>
    </div>
  );
}
