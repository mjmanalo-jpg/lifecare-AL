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
    "Hi there! I'm Sunny, your LifeCare CMS (LCMS) companion. How are you feeling today? " +
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
