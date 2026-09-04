// Shared LifeCare letterhead for printable documents (narrative report, care
// plan, and any future report in the same house format). The logo lives in
// /public so it resolves by ABSOLUTE URL inside the blank print window that
// `document.write` opens (a relative path would resolve against about:blank).

export const LIFECARE_LOGO_FILE = "/logo-lifecare2.png"; // horizontal lockup

/** Absolute URL to the LifeCare header logo (needed inside the print popup). */
export function lifecareLogoUrl(): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return origin + LIFECARE_LOGO_FILE;
}

/** The letterhead <img> for a document header. Pair with the `.brandimg` CSS. */
export function lifecareLetterhead(): string {
  return `<img class="brandimg" src="${lifecareLogoUrl()}" alt="LifeCare Living Solutions">`;
}

/** CSS for the letterhead image — drop into each report's <style>. */
export const LIFECARE_BRAND_CSS = ".brandimg{height:78px;width:auto;display:block;margin:0 0 2px}";
