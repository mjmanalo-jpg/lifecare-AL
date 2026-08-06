/**
 * Shared AI Assistant personality configuration.
 *
 * Stored as a JSON string in the `AppSetting` row with id "assistantConfig".
 * The Super Admin edits it on /superadmin/assistant; every portal that embeds
 * the assistant (e.g. the resident dashboard companion) live-subscribes to the
 * AppSetting table via useLiveQuery, so changes apply in realtime everywhere.
 * The /api/ai-assistant route also reads it server-side to build the persona,
 * so the tone can't be tampered with from the browser.
 */

export interface AssistantConfig {
  /** Display name of the assistant, shown in chat headers and used in the persona. */
  name: string;
  tone: "friendly" | "cheerful" | "calm" | "professional";
  /** First message shown in the resident companion chat. */
  greeting: string;
  /** Extra free-form instructions from the administrator (menus, house rules…). */
  instructions: string;
  useEmoji: boolean;
}

export const ASSISTANT_CONFIG_KEY = "assistantConfig";

export const DEFAULT_ASSISTANT_CONFIG: AssistantConfig = {
  name: "Sunny",
  tone: "friendly",
  greeting:
    "Hi there! I'm Sunny, your Senior Living Management System (SLMS) companion. How are you feeling today? " +
    "You can talk to me with the mic or ask about your schedule, meals, or vitals.",
  instructions: "",
  useEmoji: true,
};

/** How each tone translates into persona wording for the model. */
export const TONE_STYLES: Record<AssistantConfig["tone"], string> = {
  friendly:
    "Warm, friendly and personable — like a caring friend who knows the person well. " +
    "Use natural, conversational language with contractions. Never stiff or formal.",
  cheerful:
    "Upbeat, cheerful and encouraging — bring positive energy, celebrate small wins, " +
    "and keep spirits high without being over the top.",
  calm:
    "Calm, gentle and reassuring — unhurried, soothing and patient. " +
    "Perfect for winding down or anxious moments.",
  professional:
    "Clear, courteous and professional — efficient and precise while staying kind.",
};

export const TONE_OPTIONS: { id: AssistantConfig["tone"]; label: string; desc: string }[] = [
  { id: "friendly", label: "Friendly", desc: "Warm & personable" },
  { id: "cheerful", label: "Cheerful", desc: "Upbeat & fun" },
  { id: "calm", label: "Calm", desc: "Gentle & soothing" },
  { id: "professional", label: "Professional", desc: "Clear & courteous" },
];

/**
 * Audible preview for each tone. When the admin taps a voice or a tone on the
 * assistant screen we speak `line(name)` so they can *hear* how the assistant
 * will sound — not a generic robotic sample.
 *  - `style` is a natural-language delivery directive handed to Gemini's TTS
 *    (which follows spoken-style instructions without reading them aloud), so
 *    the same voice actually sounds friendly vs. calm vs. professional.
 *  - `rate`/`pitch` are multipliers applied to the browser Web-Speech fallback
 *    so the tone is still perceptible even in "Basic voice mode".
 */
export const TONE_PREVIEW: Record<
  AssistantConfig["tone"],
  { style: string; rate: number; pitch: number; line: (name: string) => string }
> = {
  friendly: {
    style: "a warm, friendly and personable tone, like a caring friend",
    rate: 1,
    pitch: 1,
    line: (name) => `Hi, I'm ${name}. It's really good to talk with you — I'm right here whenever you need a hand.`,
  },
  cheerful: {
    style: "an upbeat, cheerful tone, full of positive energy",
    rate: 1.08,
    pitch: 1.12,
    line: (name) => `Hi, I'm ${name}! What a lovely day — let's make it a great one together!`,
  },
  calm: {
    style: "a calm, gentle and reassuring tone, soft, slow and unhurried",
    rate: 0.9,
    pitch: 0.96,
    line: (name) => `Hello, I'm ${name}. Take a nice, slow breath — there's no rush at all. I'm right here with you.`,
  },
  professional: {
    style: "a clear, courteous and professional tone",
    rate: 1,
    pitch: 1,
    line: (name) => `Hello, I'm ${name}, your assistant. I'm here to help you clearly and efficiently whenever you need.`,
  },
};

/** Parse the stored JSON, tolerating missing/corrupt values. */
export function parseAssistantConfig(raw: string | null | undefined): AssistantConfig {
  if (!raw) return DEFAULT_ASSISTANT_CONFIG;
  try {
    const obj = JSON.parse(raw) as Partial<AssistantConfig>;
    return { ...DEFAULT_ASSISTANT_CONFIG, ...obj };
  } catch {
    return DEFAULT_ASSISTANT_CONFIG;
  }
}
