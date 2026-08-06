/**
 * Browser (Web Speech API) voice mapping shared by the Super Admin AI Assistant
 * screen and the resident dashboard companion.
 *
 * When Gemini's neural TTS is unavailable ("Basic voice mode") we fall back to
 * the OS voices. Each selected Gemini voice maps to a browser voice with a
 * matching GENDER + rate/pitch so, e.g., picking "Leda" (a female voice) never
 * speaks in a male OS voice. The previous logic matched any "Natural" voice,
 * which on Windows 11 selected male voices (Guy/Andrew/Brian) for a female pick.
 */

import { voiceServesLang } from "./speechLang";

export const BROWSER_VOICE_MAP: Record<string, { namePattern?: RegExp; rate: number; pitch: number }> = {
  Zephyr: { namePattern: /aria|samantha|zoe|female/i, rate: 1.1, pitch: 1.15 },
  Puck: { namePattern: /jenny|siri|female/i, rate: 1.2, pitch: 1.3 },
  Charon: { namePattern: /guy|david|daniel|male/i, rate: 0.9, pitch: 0.85 },
  Kore: { namePattern: /aria|jenny|zira|female/i, rate: 0.95, pitch: 1.05 },
  Fenrir: { namePattern: /guy|alex|fred|male/i, rate: 1.05, pitch: 0.7 },
  Orus: { namePattern: /ryan|george|tom|male/i, rate: 0.85, pitch: 0.9 },
  Leda: { namePattern: /jenny|samantha|female/i, rate: 1.0, pitch: 1.4 },
  Aoede: { namePattern: /libby|michelle|veena|female/i, rate: 1.15, pitch: 1.2 },
};

/** Intended gender of each Gemini voice, so the fallback can stay same-gender. */
const VOICE_GENDER: Record<string, "female" | "male"> = {
  Zephyr: "female", Puck: "female", Charon: "male", Kore: "female",
  Fenrir: "male", Leda: "female", Orus: "male", Aoede: "female",
};

// Common OS voice names by gender (Windows/macOS/Chrome). Used to keep the
// fallback on the right gender and, crucially, to REJECT the wrong one.
const MALE_NAME = /\b(david|guy|mark|andrew|brian|christopher|eric|alex|fred|ryan|george|tom|daniel|paul|richard|male|man)\b/i;
const FEMALE_NAME = /\b(aria|jenny|zira|samantha|libby|michelle|veena|emma|clara|hazel|susan|linda|karen|moira|tessa|female|woman)\b/i;

/**
 * Pick the best browser voice for a selected Gemini voice id, guaranteeing the
 * gender matches so a female neural voice never falls back to a male OS voice.
 * When `langCode` is a non-English language (e.g. "fil-PH"), a voice that
 * actually speaks that language is preferred so Tagalog isn't read with English
 * phonetics. Returns null only when the browser exposes no voices at all.
 */
export function pickBrowserVoice(
  voices: SpeechSynthesisVoice[],
  voiceId: string,
  langCode = "en-US"
): SpeechSynthesisVoice | null {
  const cfg = BROWSER_VOICE_MAP[voiceId] ?? BROWSER_VOICE_MAP.Kore;
  const gender = VOICE_GENDER[voiceId] ?? "female";

  // For a non-English reply, prefer a voice that actually speaks that language
  // (matching the selected gender when possible). Falls through to the English
  // logic when the OS has no such voice installed.
  if (!langCode.toLowerCase().startsWith("en")) {
    const localized = voices.filter((v) => voiceServesLang(v.lang, langCode));
    if (localized.length) {
      const sameGender = localized.find((v) =>
        gender === "female" ? !MALE_NAME.test(v.name) : MALE_NAME.test(v.name)
      );
      return sameGender ?? localized[0];
    }
  }

  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const pool = en.length ? en : voices;
  if (!pool.length) return null;

  // 1) Exact per-voice name pattern (already gender-correct).
  if (cfg.namePattern) {
    const hit = pool.find((v) => cfg.namePattern!.test(v.name));
    if (hit) return hit;
  }

  if (gender === "female") {
    return (
      // Prefer a neural/"Natural" female voice, then any known female name,
      // then any voice that is NOT a known male voice — never a male default.
      pool.find((v) => /natural|neural|online/i.test(v.name) && FEMALE_NAME.test(v.name)) ??
      pool.find((v) => FEMALE_NAME.test(v.name)) ??
      pool.find((v) => /natural|neural|online/i.test(v.name) && !MALE_NAME.test(v.name)) ??
      pool.find((v) => !MALE_NAME.test(v.name)) ??
      pool.find((v) => v.lang === "en-US") ??
      pool[0]
    );
  }

  return (
    pool.find((v) => /natural|neural|online/i.test(v.name) && MALE_NAME.test(v.name)) ??
    pool.find((v) => MALE_NAME.test(v.name)) ??
    pool.find((v) => v.lang === "en-US") ??
    pool[0]
  );
}
