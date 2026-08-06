/**
 * Lightweight language detection for text-to-speech.
 *
 * The assistant replies in whatever language the resident speaks — often
 * Filipino/Tagalog or Taglish. Speaking that text with an English voice (or an
 * "en-US" utterance) butchers the pronunciation, so before we speak we detect
 * the language and pass it to both the Gemini TTS prompt and the browser
 * Web-Speech fallback (utterance.lang + a matching voice).
 *
 * The markers below are Filipino function words that effectively never appear
 * in English, so a single hit is a reliable signal — and for Taglish (mixed)
 * we intentionally lean Filipino, since a Filipino voice reads English loan
 * words acceptably, while an English voice mangles the Tagalog ones.
 */
const FIL_MARKERS = new Set([
  "ang", "ng", "nang", "mga", "ako", "ikaw", "ko", "mo", "siya", "niya",
  "kami", "tayo", "kayo", "sila", "namin", "natin", "ninyo", "nila",
  "po", "opo", "oo", "hindi", "huwag", "wala", "walang", "meron", "mayroon",
  "gusto", "ayaw", "pwede", "puwede", "dapat", "kailangan", "kailan",
  "sino", "saan", "ano", "anong", "bakit", "paano", "magkano", "ilan",
  "salamat", "kumusta", "naman", "tulungan", "tulong", "bisita", "bibisita",
  "kasi", "dahil", "ito", "iyan", "iyon", "dito", "diyan", "doon",
  "ngayon", "bukas", "kahapon", "mabuhay", "sarili", "kanina",
]);

export interface SpeechLang {
  /** BCP-47 code for SpeechSynthesisUtterance.lang and voice matching. */
  code: string;
  /** Human-readable name used in the Gemini pronunciation directive. */
  name: string;
}

const ENGLISH: SpeechLang = { code: "en-US", name: "English" };
const FILIPINO: SpeechLang = { code: "fil-PH", name: "Filipino (Tagalog)" };

export function detectSpeechLang(text: string): SpeechLang {
  const words = text.toLowerCase().match(/[a-zñ'’]+/g) || [];
  for (const w of words) {
    if (FIL_MARKERS.has(w.replace(/[’']/g, "'").replace(/'.*/, ""))) return FILIPINO;
    if (FIL_MARKERS.has(w)) return FILIPINO;
  }
  return ENGLISH;
}

/** True when a browser voice's lang tag serves the given detected language. */
export function voiceServesLang(voiceLang: string, code: string): boolean {
  const v = voiceLang.toLowerCase();
  const c = code.toLowerCase();
  if (c.startsWith("fil") || c.startsWith("tl")) return v.startsWith("fil") || v.startsWith("tl");
  return v.startsWith(c.split("-")[0]);
}
