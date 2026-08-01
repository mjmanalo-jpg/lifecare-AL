import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDbConfigured } from "@/lib/models";
import { getSession } from "@/lib/auth";
import { requireTenantContext } from "@/lib/tenant";
import { withTenantDb } from "@/lib/tenantDb";
import { getEntitlements } from "@/lib/entitlements";
import {
  ASSISTANT_CONFIG_KEY,
  TONE_STYLES,
  parseAssistantConfig,
  type AssistantConfig,
} from "@/lib/assistantConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Unified AI Assistant endpoint for the Super Admin portal.
 *
 *   POST /api/ai-assistant   { action, ... }
 *
 * Actions
 *   chat     → grounded chatbot reply (knowledge-base aware)     { reply, source }
 *   tts      → text-to-speech audio (ElevenLabs → Gemini → n/a)  { audio, mimeType } | { fallback }
 *   stt      → speech-to-text transcription (Gemini audio)        { text } | { fallback }
 *   extract  → pull readable text out of an uploaded file          { text } | { error }
 *
 * Every action degrades gracefully: if no cloud key is configured (or the call
 * fails) we return `{ fallback: true }` so the browser can use its own built-in
 * Web Speech APIs instead of throwing a 500. The portal always keeps working.
 */

// ── Provider config (server-side only) ────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// Audio output over the REST generateContent endpoint requires a dedicated
// "*-tts" model. ANY other model (plain gemini-2.5-flash, …-live-preview,
// …-realtime, etc.) rejects responseModalities:["AUDIO"], which silently drops
// every request to the browser's single fallback voice — making all 8 Google
// voices sound identical. This is a subtle, common misconfig, so instead of
// only patching known-bad names we ALLOWLIST: unless the model literally ends
// in "-tts", we force a known-good TTS model and warn once.
const KNOWN_GOOD_TTS_MODEL = "gemini-2.5-flash-preview-tts";
const RAW_TTS_MODEL = process.env.GEMINI_TTS_MODEL || KNOWN_GOOD_TTS_MODEL;
const IS_TTS_MODEL = /-tts$/i.test(RAW_TTS_MODEL.trim());
const GEMINI_TTS_MODEL = IS_TTS_MODEL ? RAW_TTS_MODEL.trim() : KNOWN_GOOD_TTS_MODEL;
if (!IS_TTS_MODEL) {
  console.warn(
    `[AI Assistant] GEMINI_TTS_MODEL="${RAW_TTS_MODEL}" is not a "*-tts" model and cannot ` +
      `produce audio; using "${KNOWN_GOOD_TTS_MODEL}" instead. ` +
      `Set GEMINI_TTS_MODEL to a *-tts model to silence this warning.`
  );
}
const GEMINI_TTS_VOICE = process.env.GEMINI_TTS_VOICE || "Kore";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5";
// Rachel — a warm, natural default. Override per-request or via env.
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * The persona is no longer hardcoded — it's assembled from the shared
 * `assistantConfig` AppSetting (edited live on /superadmin/assistant) plus the
 * audience: "resident" gets a companion voice, everyone else the staff aide.
 * Reading it server-side means the tone can't be tampered with client-side and
 * every portal picks up admin changes on the very next message.
 */
async function loadAssistantConfig(): Promise<AssistantConfig> {
  if (!isDbConfigured()) return parseAssistantConfig(null);
  try {
    const context = await requireTenantContext({ allowPlatform: true });
    if (!context) return parseAssistantConfig(null);
    const row = await withTenantDb(context, (tx) => tx.appSetting.findFirst({ where: { key: ASSISTANT_CONFIG_KEY, organizationId: context.organizationId || null, communityId: context.communityId || null } }));
    return parseAssistantConfig(row?.value);
  } catch {
    return parseAssistantConfig(null);
  }
}

function buildPersona(cfg: AssistantConfig, audience: string): string {
  const style = TONE_STYLES[cfg.tone] ?? TONE_STYLES.friendly;
  const who =
    audience === "resident"
      ? `You are ${cfg.name}, the personal AI companion of a resident living at the Senior Living Management System ` +
        "assisted-living home. You chat with the resident directly. Talk like a trusted friend: " +
        "use their first name, simple everyday words, and 1-3 short sentences per reply so it is " +
        "easy to listen to out loud. Never sound like a machine — no bullet lists, no jargon, no " +
        "canned phrases. Show genuine interest in how they feel and remember what they said earlier " +
        "in the conversation. If they mention pain, an emergency, or feeling unwell, respond with " +
        "care and gently remind them to press the call bell so staff can help right away."
      : `You are ${cfg.name}, the AI assistant for the Senior Living Management System assisted-living facility's ` +
        "staff and administrators. You help with resident care, staffing, operations, compliance " +
        "and facility knowledge. Answer in 1-4 short sentences unless asked for detail, and cite " +
        "the source file name when you use the knowledge base.";
  return [
    who,
    `Personality: ${style}`,
    "Always reply in the language the user is speaking — English, Tagalog, Cebuano/Bisaya, " +
      "another Philippine dialect, or a natural mix (Taglish). Match their language and switch " +
      "the moment they do.",
    cfg.useEmoji
      ? "A light sprinkle of friendly emoji is welcome — at most one per reply."
      : "Do not use emoji.",
    "When knowledge-base or resident context is provided, ground your answer in it. If the " +
      "context does not contain the answer, say so briefly, then help from general knowledge. " +
      "Never invent resident medical facts.",
    cfg.instructions ? `Instructions from the facility administrator: ${cfg.instructions}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

interface ChatTurn {
  role: "user" | "model";
  text: string;
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
}

// ── Resident actions (Gemini function calling) ─────────────────────────────
// When a logged-in RESIDENT chats, the model gets real tools: asking for a
// visit or for help doesn't just produce words — it writes the same Visit /
// CallBell rows the portal forms create, so staff and family dashboards see
// them in realtime through the existing live-query layer.
const RESIDENT_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "request_visit",
        description:
          "Save a visit request when the resident asks for a family member or friend to come " +
          "visit. Resolve relative dates ('tomorrow', 'this Saturday afternoon') to an exact " +
          "ISO 8601 date-time using the current date-time provided. If the resident says " +
          "'my family' without a name, use the family sponsor from the resident context.",
        parameters: {
          type: "OBJECT",
          properties: {
            visitorName: { type: "STRING", description: "The visitor's name" },
            relationship: { type: "STRING", description: "Relationship to the resident (daughter, friend…)" },
            checkInTime: { type: "STRING", description: "Requested visit date-time in ISO 8601" },
            purpose: { type: "STRING", description: "Short purpose of the visit" },
          },
          required: ["visitorName", "checkInTime"],
        },
      },
      {
        name: "ring_call_bell",
        description:
          "Ring the staff call bell when the resident needs help, feels pain or unwell, or asks " +
          "for assistance. Staff are notified immediately — use it for anything urgent.",
        parameters: {
          type: "OBJECT",
          properties: {
            reason: { type: "STRING", description: "Why the resident needs help" },
          },
          required: ["reason"],
        },
      },
    ],
  },
];

/** The Resident.id behind the current session, only for RESIDENT logins. */
async function residentIdForSession(): Promise<string | null> {
  if (!isDbConfigured()) return null;
  try {
    const session = await getSession();
    if (!session || session.role !== "RESIDENT" || !session.userId) return null;
    const row = await prisma.resident.findFirst({
      where: { userId: session.userId },
      select: { id: true },
    });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

async function executeResidentTool(
  name: string,
  args: Record<string, unknown>,
  residentId: string
): Promise<Record<string, unknown>> {
  if (name === "request_visit") {
    const when = new Date(String(args.checkInTime ?? ""));
    if (isNaN(when.getTime())) {
      return { ok: false, error: "Invalid date-time — ask the resident which day and time they want." };
    }
    const visit = await prisma.visit.create({
      data: {
        residentId,
        visitorName: String(args.visitorName ?? "Family member"),
        relationship: args.relationship ? String(args.relationship) : null,
        purpose: args.purpose ? String(args.purpose) : "Requested via AI companion",
        notes: "Requested through the AI companion chat",
        checkInTime: when,
      },
    });
    return { ok: true, visitId: visit.id, scheduledFor: when.toISOString() };
  }

  if (name === "ring_call_bell") {
    const bell = await prisma.callBell.create({
      data: { residentId, reason: String(args.reason ?? "Assistance requested via AI companion") },
    });
    // Notify staff — mirrors the /api/db call-bells auto-notification.
    const resident = await prisma.resident.findUnique({
      where: { id: residentId },
      select: { firstName: true, lastName: true, roomNumber: true },
    });
    const staff = await prisma.user.findMany({
      where: { role: { in: ["FACILITY_ADMIN", "NURSE", "CAREGIVER"] }, isActive: true },
      select: { id: true },
    });
    const who = resident ? `${resident.firstName} ${resident.lastName}` : "A resident";
    const room = resident ? `Room ${resident.roomNumber}` : "their room";
    await prisma.notification.createMany({
      data: staff.map((u) => ({
        userId: u.id,
        type: "CALL_BELL" as const,
        title: `Call Bell: ${who}`,
        message: `${who} in ${room} asked the AI companion for help: "${bell.reason}".`,
        relatedEntityId: bell.id,
        relatedEntityType: "CallBell",
      })),
    });
    return { ok: true, callBellId: bell.id };
  }

  return { ok: false, error: `Unknown tool '${name}'` };
}

export async function POST(req: NextRequest) {
  const tenantContext = await requireTenantContext({ allowPlatform: true });
  if (!tenantContext) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (tenantContext.organizationId) {
    const entitlements = await getEntitlements(tenantContext.organizationId);
    if (entitlements?.features.ai_assistant?.enabled === false) return NextResponse.json({ error: "AI Assistant is not enabled for this plan" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action as string | undefined;
  if (!action) return NextResponse.json({ error: "No action" }, { status: 400 });

  switch (action) {
    case "chat":
      return handleChat(body);
    case "tts":
      return handleTts(body);
    case "stt":
      return handleStt(body);
    case "extract":
      return handleExtract(body);
    default:
      return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 });
  }
}

// ── CHAT ───────────────────────────────────────────────────────────────────
async function handleChat(body: Record<string, unknown>) {
  const message = String(body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "Empty message" }, { status: 400 });

  const audience = String(body.audience ?? "admin");
  const cfg = await loadAssistantConfig();
  const persona = body.persona ? String(body.persona) : buildPersona(cfg, audience);
  const context = String(body.context ?? "").slice(0, 24000);
  const history = Array.isArray(body.history) ? (body.history as ChatTurn[]) : [];

  // Real actions are only armed for a verified RESIDENT session with a DB.
  const residentId = audience === "resident" ? await residentIdForSession() : null;

  const systemInstruction =
    persona +
    `\nCurrent date-time: ${new Date().toString()}` +
    (residentId
      ? "\nYou can take real actions with your tools: request_visit saves a visit request the " +
        "staff and family can see; ring_call_bell alerts staff immediately. If the visitor name " +
        "or day is unclear, ask one short follow-up question first, then call the tool."
      : "") +
    (context
      ? `\n\n--- KNOWLEDGE BASE CONTEXT ---\n${context}\n--- END CONTEXT ---`
      : "");

  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [
    ...history
      .filter((t) => t && t.text)
      .slice(-12)
      .map((t) => ({ role: t.role === "model" ? "model" : "user", parts: [{ text: t.text }] })),
    { role: "user", parts: [{ text: message }] },
  ];

  if (GEMINI_API_KEY) {
    try {
      const requestBody = {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        // Warmer tones benefit from a livelier sampling temperature.
        generationConfig: {
          maxOutputTokens: 800,
          temperature: cfg.tone === "professional" ? 0.5 : 0.8,
        },
        ...(residentId ? { tools: RESIDENT_TOOLS } : {}),
      };
      const res = await fetch(`${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({ ...requestBody, contents }),
      });
      if (res.ok) {
        const data = await res.json();
        const parts: GeminiPart[] = data?.candidates?.[0]?.content?.parts ?? [];
        const call = parts.find((p) => p.functionCall)?.functionCall;

        // ── Tool call: execute for real, then let the model confirm naturally ──
        if (call && residentId) {
          let result: Record<string, unknown>;
          try {
            result = await executeResidentTool(call.name, call.args ?? {}, residentId);
          } catch (err) {
            result = { ok: false, error: (err as Error).message };
          }
          let reply = "";
          try {
            const followRes = await fetch(`${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
              body: JSON.stringify({
                ...requestBody,
                contents: [
                  ...contents,
                  { role: "model", parts: [{ functionCall: call }] },
                  { role: "user", parts: [{ functionResponse: { name: call.name, response: result } }] },
                ],
              }),
            });
            if (followRes.ok) {
              const followData = await followRes.json();
              reply =
                followData?.candidates?.[0]?.content?.parts
                  ?.map((p: { text?: string }) => p.text)
                  .join("") ?? "";
            }
          } catch {
            /* fall through to templated confirmation */
          }
          if (!reply.trim()) {
            reply = result.ok
              ? "All done — I've saved that for you and the staff can see it now."
              : "I'm sorry, I couldn't save that just now. Please try again or press the call bell for help.";
          }
          return NextResponse.json({
            reply: reply.trim(),
            source: "gemini",
            actions: [{ name: call.name, ...result }],
          });
        }

        const reply = parts.map((p) => p.text ?? "").join("");
        if (reply.trim()) {
          return NextResponse.json({ reply: reply.trim(), source: "gemini" });
        }
      } else {
        console.warn(`[AI Assistant chat] Gemini ${res.status}`);
      }
    } catch (err) {
      console.warn("[AI Assistant chat] network error", (err as Error).message);
    }
  }

  // Offline fallback — keeps the chatbot responsive without a cloud key.
  return NextResponse.json({ reply: offlineReply(message, context), source: "offline" });
}

function offlineReply(message: string, context: string): string {
  const msg = message.toLowerCase();
  if (context) {
    // Naive extractive answer: return the most relevant sentence from context.
    const sentences = context.split(/(?<=[.!?])\s+/).filter((s) => s.length > 20);
    const words = msg.split(/\W+/).filter((w) => w.length > 3);
    let best = "";
    let bestScore = 0;
    for (const s of sentences) {
      const sl = s.toLowerCase();
      const score = words.reduce((n, w) => (sl.includes(w) ? n + 1 : n), 0);
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (bestScore > 0) return `From the knowledge base: ${best.trim()}`;
  }
  if (/^(hi|hello|hey|good (morning|afternoon|evening))/.test(msg))
    return "Hello! I'm the Senior Living Management System (SLMS) AI Assistant. Ask me anything about the facility, residents, or staff — or upload documents to my knowledge base and I'll learn from them.";
  if (msg.includes("help"))
    return "I can answer questions, read documents you upload to the knowledge base, speak my replies aloud, and take voice input. What do you need?";
  if (msg.includes("thank")) return "You're very welcome. I'm here whenever you need me.";
  return "I'm running in offline mode right now (no AI key configured), so I can't reason freely. Add a GEMINI_API_KEY to unlock full answers. Meanwhile I can still search any documents you upload to the knowledge base.";
}

// ── TEXT-TO-SPEECH ───────────────────────────────────────────────────────────
async function handleTts(body: Record<string, unknown>) {
  const text = String(body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "No text" }, { status: 400 });
  const provider = String(body.provider ?? "auto");

  // 1) ElevenLabs — highest-quality neural voice, returns mp3 directly.
  if (ELEVENLABS_API_KEY && (provider === "auto" || provider === "elevenlabs")) {
    const voiceId = String(body.voiceId ?? ELEVENLABS_VOICE_ID);
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
        body: JSON.stringify({
          text: text.slice(0, 5000),
          model_id: String(body.model ?? ELEVENLABS_MODEL),
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.8,
            style: 0.4,
            use_speaker_boost: true,
          },
        }),
        }
      );
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        return NextResponse.json({
          audio: buf.toString("base64"),
          mimeType: "audio/mpeg",
          provider: "elevenlabs",
        });
      }
      console.warn(`[AI Assistant tts] ElevenLabs ${res.status}`);
    } catch (err) {
      console.warn("[AI Assistant tts] ElevenLabs network error", (err as Error).message);
    }
  }

  // 2) Gemini TTS — returns raw PCM (L16 @ 24kHz); wrap it in a WAV container.
  if (GEMINI_API_KEY && (provider === "auto" || provider === "gemini")) {
    try {
      const res = await fetch(`${GEMINI_BASE}/${GEMINI_TTS_MODEL}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: String(body.voiceId ?? GEMINI_TTS_VOICE) },
              },
            },
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const inline = data?.candidates?.[0]?.content?.parts?.find(
          (p: { inlineData?: unknown }) => p.inlineData
        )?.inlineData;
        if (inline?.data) {
          const rate = parseRate(inline.mimeType) || 24000;
          const wav = pcmToWav(Buffer.from(inline.data, "base64"), rate);
          return NextResponse.json({
            audio: wav.toString("base64"),
            mimeType: "audio/wav",
            provider: "gemini",
          });
        }
      } else {
        console.warn(`[AI Assistant tts] Gemini ${res.status}`);
      }
    } catch (err) {
      console.warn("[AI Assistant tts] Gemini network error", (err as Error).message);
    }
  }

  // 3) No cloud voice available → let the browser speak with the Web Speech API.
  return NextResponse.json({ fallback: true, reason: "no cloud TTS available" });
}

/** Extract the sample-rate hint from a Gemini audio mime type e.g. "audio/L16;rate=24000". */
function parseRate(mimeType?: string): number | null {
  if (!mimeType) return null;
  const m = mimeType.match(/rate=(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Wrap raw 16-bit mono PCM in a minimal WAV (RIFF) header so browsers can play it. */
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// ── SPEECH-TO-TEXT ───────────────────────────────────────────────────────────
async function handleStt(body: Record<string, unknown>) {
  const audio = String(body.audio ?? "");
  const mimeType = String(body.mimeType ?? "audio/webm");
  if (!audio) return NextResponse.json({ error: "No audio" }, { status: 400 });

  if (!GEMINI_API_KEY) {
    return NextResponse.json({ fallback: true, reason: "no cloud STT configured" });
  }

  try {
    const res = await fetch(`${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text:
                  "Transcribe this audio to plain text verbatim, in its original language — " +
                  "English, Tagalog, Cebuano/Bisaya, another Philippine dialect, or a mix. " +
                  "Do not translate. Return only the transcription, no commentary.",
              },
              { inlineData: { mimeType, data: audio } },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join("") ?? "";
      return NextResponse.json({ text: text.trim() });
    }
    console.warn(`[AI Assistant stt] Gemini ${res.status}`);
  } catch (err) {
    console.warn("[AI Assistant stt] network error", (err as Error).message);
  }
  return NextResponse.json({ fallback: true, reason: "cloud STT failed" });
}

// ── FILE TEXT EXTRACTION ─────────────────────────────────────────────────────
// For binary docs the browser can't read (PDF, images, scans), we let Gemini's
// multimodal file understanding pull the text out. Plain-text formats are read
// client-side and never reach this handler.
async function handleExtract(body: Record<string, unknown>) {
  const data = String(body.base64 ?? "");
  const mimeType = String(body.mimeType ?? "application/octet-stream");
  const filename = String(body.filename ?? "file");
  if (!data) return NextResponse.json({ error: "No file data" }, { status: 400 });

  if (!GEMINI_API_KEY) {
    return NextResponse.json({
      error: "no-extractor",
      reason: "Binary files need a GEMINI_API_KEY to extract text. Only plain-text files can be read offline.",
    });
  }

  try {
    const res = await fetch(`${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Extract ALL readable text content from this file ("${filename}"). Preserve headings, lists and tables as plain text/markdown. Output only the extracted content with no preamble.`,
              },
              { inlineData: { mimeType, data } },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 8192 },
      }),
    });
    if (res.ok) {
      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join("") ?? "";
      if (text.trim()) return NextResponse.json({ text: text.trim() });
      return NextResponse.json({ error: "empty", reason: "No text found in file" });
    }
    const detail = await res.text().catch(() => "");
    console.warn(`[AI Assistant extract] Gemini ${res.status} ${detail.slice(0, 160)}`);
    return NextResponse.json({ error: "extract-failed", reason: `Gemini ${res.status}` });
  } catch (err) {
    return NextResponse.json({ error: "network", reason: (err as Error).message });
  }
}
