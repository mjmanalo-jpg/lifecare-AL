// ─────────────────────────────────────────────────────────────
// SweetAlert2-compatible drop-in.
//
// Plain success / error / warning / info NOTIFICATIONS are routed to the
// globally-mounted shadcn toast (see components/ui/global-toast). Everything
// else — confirm dialogs (showCancelButton), prompts (input), loading spinners
// (didOpen/showLoading), and rich HTML popups — is DELEGATED to the real
// SweetAlert2 untouched, so existing flows behave exactly as before.
//
// Usage is unchanged: `import Swal from "@/lib/swal"` then `Swal.fire(...)`.
// ─────────────────────────────────────────────────────────────

import RealSwal from "sweetalert2";
import { pushGlobalToast, type GlobalToastVariant } from "@/components/ui/global-toast";
import { openGlobalConfirm, type ConfirmVariant } from "@/components/ui/global-confirm";

type SweetIcon = "success" | "error" | "warning" | "info" | "question";

interface FireOptions {
  title?: string;
  titleText?: string;
  text?: string;
  html?: unknown;
  icon?: SweetIcon;
  showCancelButton?: boolean;
  showDenyButton?: boolean;
  input?: unknown;
  timer?: number;
  showConfirmButton?: boolean;
  toast?: boolean;
  didOpen?: unknown;
  willOpen?: unknown;
  footer?: unknown;
  imageUrl?: unknown;
  [key: string]: unknown;
}

interface FireResult {
  isConfirmed: boolean;
  isDenied: boolean;
  isDismissed: boolean;
  value?: unknown;
}

function toVariant(icon?: SweetIcon): GlobalToastVariant {
  if (icon === "error") return "error";
  if (icon === "warning") return "warning";
  if (icon === "info" || icon === "question") return "info";
  return "success";
}

/**
 * A "plain notification" is a simple message popup — the kind that only shows an
 * OK button (or auto-dismisses). These become toasts. Anything interactive or
 * rich is left to SweetAlert2.
 */
function isPlainNotification(o: FireOptions): boolean {
  if (o.showCancelButton || o.showDenyButton) return false; // confirm / choice
  if (o.input) return false; // prompt
  // NOTE: `toast: true` is intentionally NOT bailed out here — a plain corner
  // toast (title + icon + timer) is routed to the app's shadcn toaster so it
  // matches every other notification. Only toasts with rich/custom content
  // (html, didOpen, …) fall through below and are left to SweetAlert2.
  if (o.didOpen || o.willOpen) return false; // loading / custom lifecycle
  if (o.html || o.imageUrl || o.footer) return false; // rich content
  if (o.showConfirmButton === false && !o.timer) return false; // spinner-style modal
  const icon = o.icon;
  return icon === undefined || icon === "success" || icon === "error" || icon === "warning" || icon === "info";
}

/**
 * A "confirm" is a two-choice popup (Cancel + Confirm). Plain-text confirms are
 * routed to the shadcn AlertDialog; anything with an input/rich HTML/custom
 * lifecycle is left to SweetAlert2.
 */
function isConfirm(o: FireOptions): boolean {
  return Boolean(o.showCancelButton) && !o.input && !o.html && !o.didOpen && !o.willOpen;
}

const DANGER_COLORS = ["#ef4444", "#dc2626", "#f44336", "#e11d48", "#b91c1c", "#c0392b", "#e3342f", "#d33"];
// Greens the app uses for positive/confirming actions (emerald, sage, etc.).
const SUCCESS_COLORS = ["#16a34a", "#22c55e", "#15803d", "#10b981", "#059669", "#4caf50", "#2e7d32", "#7e9b6f", "#6e8a60"];
const WARNING_COLORS = ["#f59e0b", "#d97706", "#f97316", "#ea580c", "#eab308", "#ca8a04", "#f0ad4e"];

function confirmVariant(o: FireOptions): ConfirmVariant {
  const color = String(o.confirmButtonColor ?? "").toLowerCase();
  if (DANGER_COLORS.some((r) => color.includes(r))) return "danger";
  const text = `${o.title ?? ""} ${o.text ?? ""} ${o.confirmButtonText ?? ""}`.toLowerCase();
  if (/\b(delete|remove|discard|deactivate|permanently|cannot be undone|irreversible)\b/.test(text)) return "danger";
  if (SUCCESS_COLORS.some((r) => color.includes(r))) return "success";
  if (WARNING_COLORS.some((r) => color.includes(r))) return "warning";
  if (o.icon === "warning" || o.icon === "error") return "warning";
  if (o.icon === "success") return "success";
  if (o.icon === "info") return "info";
  return "default";
}

function customFire(a?: FireOptions | string, b?: string, c?: SweetIcon): Promise<FireResult> {
  const o: FireOptions = typeof a === "string" ? { title: a, text: b, icon: c } : a || {};

  if (isConfirm(o)) {
    return openGlobalConfirm({
      title: o.title != null ? String(o.title) : undefined,
      description: o.text != null ? String(o.text) : undefined,
      confirmText: o.confirmButtonText != null ? String(o.confirmButtonText) : undefined,
      cancelText: o.cancelButtonText != null ? String(o.cancelButtonText) : undefined,
      variant: confirmVariant(o),
    }).then((r) => ({ isConfirmed: r.confirmed, isDenied: false, isDismissed: !r.confirmed, value: undefined }));
  }

  if (isPlainNotification(o)) {
    // Mimic SweetAlert2's single-instance behaviour: firing a new popup closes
    // any open one (e.g. a loading spinner that this success message replaces).
    try {
      RealSwal.close();
    } catch {
      /* no-op */
    }
    const title = String(o.title ?? o.titleText ?? "");
    const desc = o.text != null ? String(o.text) : undefined;
    pushGlobalToast(toVariant(o.icon), title, desc);
    return Promise.resolve({ isConfirmed: true, isDenied: false, isDismissed: false, value: undefined });
  }

  // Delegate everything else to the real SweetAlert2 — but re-skinned to match
  // the app's design system (see `.al-swal2-*` rules in globals.css). Prompts
  // (textarea/text/select), rich-HTML popups, choice dialogs and loading
  // spinners all flow through here, so theming this one call site restyles
  // every raw SweetAlert2 dialog across the app in one place.
  //
  // NOTE: must stay bound to RealSwal — SweetAlert2's `fire` uses `this`
  // internally (`new this(...)`), so an unbound reference throws
  // "this is not a constructor" for input/HTML dialogs.
  const fire = (RealSwal.fire as (...args: unknown[]) => Promise<FireResult>).bind(RealSwal);
  return fire(themed(o));
}

/**
 * Merge the app's SweetAlert2 skin into a fire() options object. Sets
 * `buttonsStyling: false` so our CSS fully controls the buttons (dropping
 * SweetAlert2's inline `confirmButtonColor`), and maps every part of the popup
 * to an `al-swal2-*` class. The confirm button also gets a variant class
 * derived from the call's intent (danger/success/warning/info) so semantic
 * colour is preserved without touching call sites. Any per-call `customClass`
 * the caller passed is preserved and appended (e.g. a custom width).
 * Corner-toasts (`toast: true`) keep their native styling.
 */
function themed(o: FireOptions): FireOptions {
  if (o.toast) return o;

  const base: Record<string, string> = {
    container: "al-swal2-container",
    popup: "al-swal2-popup",
    title: "al-swal2-title",
    htmlContainer: "al-swal2-html",
    closeButton: "al-swal2-close",
    icon: "al-swal2-icon",
    image: "al-swal2-image",
    input: "al-swal2-input",
    inputLabel: "al-swal2-input-label",
    validationMessage: "al-swal2-validation",
    actions: "al-swal2-actions",
    confirmButton: `al-swal2-btn al-swal2-confirm al-swal2-confirm--${confirmVariant(o)}`,
    denyButton: "al-swal2-btn al-swal2-deny",
    cancelButton: "al-swal2-btn al-swal2-cancel",
    loader: "al-swal2-loader",
    footer: "al-swal2-footer",
    timerProgressBar: "al-swal2-timer",
  };

  const userCC =
    o.customClass && typeof o.customClass === "object"
      ? (o.customClass as Record<string, string>)
      : {};
  const customClass: Record<string, string> = { ...base };
  for (const key of Object.keys(userCC)) {
    const extra = userCC[key];
    if (!extra) continue;
    customClass[key] = customClass[key] ? `${customClass[key]} ${extra}` : extra;
  }

  return { buttonsStyling: false, ...o, customClass };
}

// Proxy the real Swal so `fire` is intercepted while `close`, `showLoading`,
// `mixin`, `isVisible`, etc. delegate straight through (bound to Swal).
const swalProxy = new Proxy(RealSwal as unknown as Record<string, unknown>, {
  get(target, prop, receiver) {
    if (prop === "fire") return customFire;
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  },
});

export default swalProxy as unknown as typeof RealSwal;
