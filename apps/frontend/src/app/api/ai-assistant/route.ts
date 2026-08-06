import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { TransportRequestType, ServiceRequestCategory, ServiceRequestPriority, ServiceTeam } from "@prisma/client";
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
        "and facility knowledge. Answer in 1-4 short sentences unless asked for detail.";
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
      "Never invent resident medical facts. Answer naturally and conversationally — never mention, " +
      "cite, name, or reference the knowledge-base documents or source files you used (for example, " +
      "do not append a source like \"(SLMS — ...)\" to your reply).",
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
      {
        name: "schedule_transport",
        description:
          "Schedule a transport / ride when the resident asks to arrange transportation — to a medical " +
          "appointment, dialysis, therapy, a family outing, etc. This is the conversational version of the " +
          "Request Transport form: gather the same details by asking short, friendly follow-up questions — " +
          "the trip type, the destination, the pickup date & time (resolve relative dates like 'next Tuesday " +
          "9am' to ISO 8601 using the current date-time), the purpose of the trip, whether it is a round trip, " +
          "whether a wheelchair-accessible vehicle is needed, whether they want a staff escort (and if so a " +
          "nurse or a caregiver), and any extra notes. Only the destination and pickup date-time are strictly " +
          "required — for anything the resident doesn't mention, ask once, and if they're unsure use sensible " +
          "defaults (round trip, no wheelchair, no escort) rather than blocking the booking.",
        parameters: {
          type: "OBJECT",
          properties: {
            destination: { type: "STRING", description: "Where the resident wants to go (drop-off)" },
            requestedDate: { type: "STRING", description: "Requested pickup date-time in ISO 8601" },
            type: { type: "STRING", description: "One of: MEDICAL_APPOINTMENT, DIALYSIS, THERAPY, FAMILY_OUTING, EMERGENCY_TRANSFER, OTHER" },
            purpose: { type: "STRING", description: "Short reason for the trip, e.g. 'Cardiology follow-up'" },
            pickupLocation: { type: "STRING", description: "Pickup point if not the facility" },
            wheelchairNeeded: { type: "BOOLEAN", description: "True if a wheelchair-accessible vehicle is needed" },
            returnRequired: { type: "BOOLEAN", description: "True if a return trip back is needed (round trip)" },
            escortRequired: { type: "BOOLEAN", description: "True if the resident wants a staff member to escort them" },
            escortRole: { type: "STRING", description: "Who should escort: NURSE or CAREGIVER (only when escortRequired is true)" },
            notes: { type: "STRING", description: "Any additional details the resident mentions about the trip" },
          },
          required: ["destination", "requestedDate"],
        },
      },
      {
        name: "request_service",
        description:
          "Open a hotel-services / concierge ticket when the resident asks for a service in their room " +
          "or the facility — housekeeping or room cleaning, linen or laundry, room-service meals or " +
          "snacks, aircon/temperature, or repairs (plumbing, electrical, Wi-Fi/TV). Choose the best " +
          "category and summarize what they want in details.",
        parameters: {
          type: "OBJECT",
          properties: {
            category: { type: "STRING", description: "One of: AIRCON_HVAC, HOUSEKEEPING, ROOM_SERVICE, LAUNDRY, REPAIRS" },
            subType: { type: "STRING", description: "Short label, e.g. 'Linen Change', 'Temp Adjust', 'Wi-Fi/TV', 'Snacks'" },
            details: { type: "STRING", description: "What the resident is requesting, in their words" },
            priority: { type: "STRING", description: "ROUTINE (default), URGENT, or EMERGENCY" },
          },
          required: ["details"],
        },
      },
    ],
  },
];

/** Identity + tenant of the Resident behind the current session (RESIDENT logins only). */
interface ResidentIdentity {
  id: string;
  firstName: string | null;
  communityId: string | null;
  organizationId: string | null;
}
async function residentForSession(): Promise<ResidentIdentity | null> {
  if (!isDbConfigured()) return null;
  try {
    const session = await getSession();
    if (!session || session.role !== "RESIDENT" || !session.userId) return null;
    const row = await prisma.resident.findFirst({
      where: { userId: session.userId },
      select: { id: true, firstName: true, communityId: true, organizationId: true },
    });
    return row ?? null;
  } catch {
    return null;
  }
}

async function executeResidentTool(
  name: string,
  args: Record<string, unknown>,
  resident: ResidentIdentity
): Promise<Record<string, unknown>> {
  // Every row this writes is stamped with the resident's own tenant so it stays
  // scoped to their community/org — never orphaned or visible cross-tenant.
  const tenant = { communityId: resident.communityId, organizationId: resident.organizationId };

  if (name === "request_visit") {
    const when = new Date(String(args.checkInTime ?? ""));
    if (isNaN(when.getTime())) {
      return { ok: false, error: "Invalid date-time — ask the resident which day and time they want." };
    }
    const visit = await prisma.visit.create({
      data: {
        residentId: resident.id,
        visitorName: String(args.visitorName ?? "Family member"),
        relationship: args.relationship ? String(args.relationship) : null,
        purpose: args.purpose ? String(args.purpose) : "Requested via AI companion",
        notes: "Requested through the AI companion chat",
        checkInTime: when,
        ...tenant,
      },
    });
    return { ok: true, visitId: visit.id, scheduledFor: when.toISOString() };
  }

  if (name === "ring_call_bell") {
    const bell = await prisma.callBell.create({
      data: { residentId: resident.id, reason: String(args.reason ?? "Assistance requested via AI companion"), ...tenant },
    });
    // Notify staff — mirrors the /api/db call-bells auto-notification. Scope the
    // recipients to the resident's OWN community (via active memberships), so a
    // call bell never pages staff at other facilities in the same database.
    const info = await prisma.resident.findUnique({
      where: { id: resident.id },
      select: { firstName: true, lastName: true, roomNumber: true },
    });
    const staff = resident.communityId
      ? await prisma.communityMembership.findMany({
          where: { communityId: resident.communityId, status: "ACTIVE", role: { in: ["FACILITY_ADMIN", "NURSE", "CAREGIVER"] } },
          select: { userId: true },
        })
      : [];
    const who = info ? `${info.firstName} ${info.lastName}` : "A resident";
    const room = info ? `Room ${info.roomNumber}` : "their room";
    if (staff.length) {
      await prisma.notification.createMany({
        data: staff.map((m) => ({
          userId: m.userId,
          type: "CALL_BELL" as const,
          title: `Call Bell: ${who}`,
          message: `${who} in ${room} asked the AI companion for help: "${bell.reason}".`,
          relatedEntityId: bell.id,
          relatedEntityType: "CallBell",
          ...tenant,
        })),
      });
    }
    return { ok: true, callBellId: bell.id };
  }

  if (name === "schedule_transport") {
    const when = new Date(String(args.requestedDate ?? ""));
    if (isNaN(when.getTime())) {
      return { ok: false, error: "Invalid date-time — ask the resident which day and time they want to travel." };
    }
    const destination = String(args.destination ?? "").trim();
    if (!destination) return { ok: false, error: "Ask the resident where they would like to go." };
    const TYPES = ["MEDICAL_APPOINTMENT", "DIALYSIS", "THERAPY", "FAMILY_OUTING", "EMERGENCY_TRANSFER", "OTHER"];
    const type = (TYPES.includes(String(args.type)) ? String(args.type) : "MEDICAL_APPOINTMENT") as TransportRequestType;
    // Only honour an escort role the resident actually asked for, and only when
    // they requested an escort — mirrors the Request Transport form exactly.
    const escortRequired = Boolean(args.escortRequired);
    const escortRole = escortRequired
      ? (["NURSE", "CAREGIVER"].includes(String(args.escortRole)) ? String(args.escortRole) : "NURSE")
      : null;
    // Emergency transfers jump the queue, same as the form's priority mapping.
    const priority = type === "EMERGENCY_TRANSFER" ? "EMERGENCY" : "NORMAL";
    // Keep the resident's own words; fall back to a marker when none were given.
    const notes = args.notes ? String(args.notes).trim() : "Requested through the AI companion chat";
    const req = await prisma.transportRequest.create({
      data: {
        residentId: resident.id,
        type,
        destination,
        dropoffLocation: destination,
        pickupLocation: args.pickupLocation ? String(args.pickupLocation) : null,
        purpose: args.purpose ? String(args.purpose) : "Requested via AI companion",
        requestedDate: when,
        returnRequired: args.returnRequired !== false,
        wheelchairNeeded: Boolean(args.wheelchairNeeded),
        escortRequired,
        escortRole,
        priority,
        source: "AI_COMPANION",
        notes,
        ...tenant,
      },
    });
    return { ok: true, transportRequestId: req.id, destination, type, escortRequired, wheelchairNeeded: Boolean(args.wheelchairNeeded), returnRequired: args.returnRequired !== false, scheduledFor: when.toISOString() };
  }

  if (name === "request_service") {
    const details = String(args.details ?? "").trim();
    if (!details) return { ok: false, error: "Ask the resident what service they need." };
    const CATS = ["AIRCON_HVAC", "HOUSEKEEPING", "ROOM_SERVICE", "LAUNDRY", "REPAIRS"];
    const category = (CATS.includes(String(args.category)) ? String(args.category) : "HOUSEKEEPING") as ServiceRequestCategory;
    const TEAM: Record<string, ServiceTeam> = {
      AIRCON_HVAC: "MAINTENANCE_ENGINEER", HOUSEKEEPING: "HOUSEKEEPING_TEAM", ROOM_SERVICE: "KITCHEN",
      LAUNDRY: "HOUSEKEEPING_TEAM", REPAIRS: "MAINTENANCE_ENGINEER",
    };
    const PRIS = ["ROUTINE", "URGENT", "EMERGENCY"];
    const priority = (PRIS.includes(String(args.priority)) ? String(args.priority) : "ROUTINE") as ServiceRequestPriority;
    const info = await prisma.resident.findUnique({ where: { id: resident.id }, select: { roomNumber: true } });
    const req = await prisma.serviceRequest.create({
      data: {
        residentId: resident.id,
        roomNumber: info?.roomNumber ?? null,
        category,
        subType: args.subType ? String(args.subType) : null,
        details,
        priority,
        source: "AI_COMPANION",
        assignedTeam: TEAM[category] ?? ("CONCIERGE" as ServiceTeam),
        ...tenant,
      },
    });
    return { ok: true, serviceRequestId: req.id, category, subType: args.subType ?? null };
  }

  return { ok: false, error: `Unknown tool '${name}'` };
}

// ── Per-action authorization ──────────────────────────────────────────────
// Each action is limited to the portals that legitimately use it, so a
// low-privilege session (FAMILY, or a RESIDENT reaching for staff tools) can't
// drive the endpoint, exfiltrate crafted context, or burn Gemini/ElevenLabs
// quota. Callers (verified against the codebase):
//   chat/admin, tts, extract → SuperAdmin & Facility Admin assistant; Nurse &
//                              Physician clinical-notes chat
//   chat/resident, tts, stt  → the resident AI companion
//   sbar, endorsement        → Nurse/Caregiver clinical drafts
const CLINICAL_STAFF = new Set(["SUPERADMIN", "FACILITY_ADMIN", "NURSE", "CAREGIVER", "PHYSICIAN"]);
const ADMIN_STAFF = new Set(["SUPERADMIN", "FACILITY_ADMIN"]);

function actionAllowed(action: string, audience: string, role: string, isPlatform: boolean): boolean {
  if (isPlatform) return true; // platform operators are superusers
  switch (action) {
    case "chat":
      return audience === "resident" ? role === "RESIDENT" : CLINICAL_STAFF.has(role);
    case "tts":
    case "stt":
      // Voice I/O serves both the resident companion and the staff assistant.
      return role === "RESIDENT" || CLINICAL_STAFF.has(role);
    case "sbar":
    case "endorsement":
    case "shift-recap":
      return CLINICAL_STAFF.has(role);
    case "extract":
      return ADMIN_STAFF.has(role);
    default:
      return false;
  }
}

export async function POST(req: NextRequest) {
  const tenantContext = await requireTenantContext({ allowPlatform: true });
  if (!tenantContext) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action as string | undefined;
  if (!action) return NextResponse.json({ error: "No action" }, { status: 400 });
  const audience = String(body.audience ?? "admin");

  // Role gate before any provider call or DB action.
  if (!actionAllowed(action, audience, tenantContext.role, tenantContext.isPlatform)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (tenantContext.organizationId) {
    const entitlements = await getEntitlements(tenantContext.organizationId);
    if (entitlements?.features.ai_assistant?.enabled === false) return NextResponse.json({ error: "AI Assistant is not enabled for this plan" }, { status: 403 });
  }

  switch (action) {
    case "chat":
      return handleChat(body);
    case "tts":
      return handleTts(body);
    case "stt":
      return handleStt(body);
    case "extract":
      return handleExtract(body);
    case "sbar":
      return handleSbar(body);
    case "endorsement":
      return handleEndorsement(body);
    case "shift-recap":
      return handleShiftRecap(body, tenantContext);
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
  const residentRec = audience === "resident" ? await residentForSession() : null;
  const residentId = residentRec?.id ?? null;

  const systemInstruction =
    persona +
    `\nCurrent date-time: ${new Date().toString()}` +
    (residentRec?.firstName
      ? `\nYou are speaking with ${residentRec.firstName}. Address them warmly by their first name when it feels natural. Never output a placeholder like "[Resident Name]" — if you don't know a name, just leave it out.`
      : "") +
    (residentId
      ? "\nYou can take real actions with your tools: request_visit saves a visit request the " +
        "staff and family can see; ring_call_bell alerts staff immediately; schedule_transport books a " +
        "ride to an appointment or outing (get the destination and the pickup day/time first); " +
        "request_service opens a hotel-services ticket for housekeeping, room service, laundry, aircon, " +
        "or repairs. If a needed detail (visitor name, destination, day/time, or which service) is " +
        "unclear, ask one short follow-up question first. Once you have what you need you MUST call the " +
        "matching tool in that same turn — the request only becomes real when the tool runs, so never " +
        "merely say you 'will' or 'have' arranged something without actually calling the tool. After the " +
        "tool runs, confirm warmly in one sentence what you arranged."
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
        if (call && residentRec) {
          let result: Record<string, unknown>;
          try {
            result = await executeResidentTool(call.name, call.args ?? {}, residentRec);
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

// ── SBAR RECOMMENDATION DRAFT ─────────────────────────────────────────────────
// Generate ONLY the Recommendation (the "R" of SBAR) for a clinical escalation
// from the Situation / Background / Assessment the nurse entered. Returns
// { recommendation, source:"gemini" } or { fallback:true } so the caller can
// use its own templated draft when no cloud key is configured or the call fails.
async function handleSbar(body: Record<string, unknown>) {
  const situation = String(body.situation ?? "").trim();
  if (!situation) return NextResponse.json({ error: "No situation" }, { status: 400 });
  const background = String(body.background ?? "").trim();
  const assessment = String(body.assessment ?? "").trim();
  const priority = String(body.priority ?? "URGENT").trim();
  const resident = String(body.resident ?? "the resident").trim();

  if (!GEMINI_API_KEY) return NextResponse.json({ fallback: true, reason: "no GEMINI_API_KEY" });

  const systemInstruction =
    "You are a clinical decision-support assistant for an assisted-living facility, helping a " +
    "nurse complete the Recommendation (the 'R') of an SBAR escalation to the physician/on-call. " +
    "Write ONLY the recommendation: a concise, specific, actionable set of next steps for the care " +
    "team and physician (2-4 short sentences, or a brief action list). Be clinically appropriate and " +
    "safe; scale urgency to the stated priority. " +
    "Ground every step in the specific details given: address the exact problem in the Situation, " +
    "reflect the clinical judgement in the Assessment, and account for the Background — especially " +
    "the resident's documented allergies and current medications (avoid contraindicated or duplicate " +
    "therapy, and note relevant interactions or that a relevant drug is already prescribed). " +
    "Do NOT restate the situation, background, or " +
    "assessment. Do NOT add a preamble such as 'Request physician review for <name>' or 'Recommend:'. " +
    "Never invent specific vitals, doses, or diagnoses that were not provided. Output only the " +
    "recommendation text, no headings, no quotes.";

  const userText =
    `Priority: ${priority}\nResident: ${resident}\n` +
    `Situation: ${situation}\n` +
    (background ? `Background: ${background}\n` : "") +
    (assessment ? `Assessment: ${assessment}\n` : "");

  try {
    const res = await fetch(`${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 384, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
      if (text) return NextResponse.json({ recommendation: text, source: "gemini" });
    } else {
      console.warn(`[AI Assistant sbar] Gemini ${res.status}`);
    }
  } catch (err) {
    console.warn("[AI Assistant sbar] network error", (err as Error).message);
  }
  return NextResponse.json({ fallback: true, reason: "cloud draft failed" });
}

// ── SHIFT ENDORSEMENT (HANDOVER) SUMMARY ──────────────────────────────────────
// Write a professional end-of-shift endorsement from the fields the nurse/
// caregiver recorded. Returns { summary, source:"gemini" } or { fallback:true }
// so the caller can use its own templated summary offline.
async function handleEndorsement(body: Record<string, unknown>) {
  const shift = String(body.shift ?? "shift").trim();
  const residentUpdates = String(body.residentUpdates ?? "").trim();
  const incidentsOccurred = Boolean(body.incidentsOccurred);
  const incidentDetails = String(body.incidentDetails ?? "").trim();
  const medications = String(body.medications ?? "").trim();
  const tasks = String(body.tasks ?? "").trim();
  const handoverNotes = String(body.handoverNotes ?? "").trim();

  // Nothing meaningful to summarise → let the caller fall back.
  if (!residentUpdates && !incidentsOccurred && !medications && !tasks && !handoverNotes) {
    return NextResponse.json({ fallback: true, reason: "no content" });
  }
  if (!GEMINI_API_KEY) return NextResponse.json({ fallback: true, reason: "no GEMINI_API_KEY" });

  const systemInstruction =
    "You are a clinical assistant writing a professional end-of-shift endorsement (handover " +
    "summary) for an assisted-living facility. From the recorded shift details, write a clear, " +
    "concise handover the incoming shift can read in seconds: overall status, key resident updates, " +
    "any incidents, medications given, tasks completed, and what to carry over/watch. 3-6 sentences, " +
    "professional clinical tone. Do NOT invent residents, vitals, doses, or events that were not " +
    "provided. No headings, no bullet markup, no preamble like 'Here is' — output only the endorsement.";

  const userText =
    `Shift: ${shift}\n` +
    (residentUpdates ? `Resident updates: ${residentUpdates}\n` : "") +
    `Incidents: ${incidentsOccurred ? incidentDetails || "occurred — see incident log" : "none reported"}\n` +
    (medications ? `Medications administered: ${medications}\n` : "") +
    (tasks ? `Tasks completed: ${tasks}\n` : "") +
    (handoverNotes ? `Carry-over notes: ${handoverNotes}\n` : "");

  try {
    const res = await fetch(`${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        // thinkingBudget:0 — gemini-2.5-flash "thinking" tokens count against
        // maxOutputTokens; without this the reasoning eats the budget and the
        // summary gets truncated mid-sentence.
        generationConfig: { temperature: 0.4, maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
      if (text) return NextResponse.json({ summary: text, source: "gemini" });
    } else {
      console.warn(`[AI Assistant endorsement] Gemini ${res.status}`);
    }
  } catch (err) {
    console.warn("[AI Assistant endorsement] network error", (err as Error).message);
  }
  return NextResponse.json({ fallback: true, reason: "cloud draft failed" });
}

// ── SHIFT RECAP (activity-based endorsement) ──────────────────────────────────
// Build the endorsement from what actually happened in the system this shift:
// the clinician's OWN logged activity (meds given/held/refused, incidents filed,
// escalations raised, physician calls, tasks completed) PLUS the unit's open
// carry-over. Returns deterministic structured field strings (nothing invented)
// AND an AI narrative summarising them. { summary, fields, source, empty }.
const SHIFT_WINDOWS: Record<string, [number, number]> = {
  MORNING: [6, 14], AFTERNOON: [14, 22], NIGHT: [22, 6], OVERNIGHT: [22, 6],
};
function shiftWindow(shiftType: string, dateStr: string): { start: Date; end: Date } {
  const base = new Date(dateStr);
  const d = isNaN(base.getTime()) ? new Date() : base;
  const [sh, eh] = SHIFT_WINDOWS[shiftType.toUpperCase()] ?? [0, 24];
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), eh, 0, 0, 0);
  if (eh <= sh) end.setDate(end.getDate() + 1); // overnight wraps past midnight
  return { start, end };
}
type ResLite = { firstName?: string | null; lastName?: string | null; roomNumber?: string | null } | null;
const rn = (r: ResLite) =>
  r ? `${`${(r.firstName ?? "").trim()} ${(r.lastName ?? "").charAt(0)}.`.trim()}${r.roomNumber ? ` (Rm ${r.roomNumber})` : ""}` : "a resident";

async function handleShiftRecap(
  body: Record<string, unknown>,
  ctx: NonNullable<Awaited<ReturnType<typeof requireTenantContext>>>,
) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const communityId = ctx.communityId;
  if (!communityId) return NextResponse.json({ error: "Select a community first." }, { status: 409 });

  const shiftType = String(body.shiftType ?? "MORNING");
  const { start, end } = shiftWindow(shiftType, String(body.date ?? new Date().toISOString()));
  const inWindow = { gte: start, lte: end };
  const resSel = { select: { firstName: true, lastName: true, roomNumber: true } };

  const me = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true, staff: { select: { id: true } } } });
  const myName = me?.name ?? "";
  const myStaffId = me?.staff?.id ?? null;

  const [meds, incidents, escMine, comms, tasksDone, openEsc, pendingTasks, dueFollowups] = await Promise.all([
    prisma.medicationAdministration.findMany({ where: { recordedById: ctx.userId, actualTime: inWindow, resident: { communityId } }, select: { status: true, dosage: true, route: true, reasonForRefusal: true, heldReason: true, medication: { select: { name: true } }, resident: resSel } }),
    prisma.incident.findMany({ where: { reportedById: ctx.userId, createdAt: inWindow }, select: { incidentType: true, severity: true, description: true, resident: resSel } }),
    myName ? prisma.escalation.findMany({ where: { raisedBy: myName, createdAt: inWindow }, select: { situation: true, priority: true, status: true, resident: resSel } }) : Promise.resolve([]),
    prisma.physicianCommunication.findMany({ where: { loggedById: ctx.userId, occurredAt: inWindow }, select: { physicianName: true, method: true, reason: true, resident: resSel } }),
    myStaffId ? prisma.task.findMany({ where: { assignedToId: myStaffId, status: "COMPLETED", completedAt: inWindow }, select: { title: true, resident: resSel } }) : Promise.resolve([]),
    prisma.escalation.findMany({ where: { resident: { communityId }, status: { notIn: ["RESOLVED", "CANCELLED"] } }, select: { situation: true, resident: resSel }, take: 20 }),
    prisma.task.count({ where: { resident: { communityId }, status: { in: ["PENDING", "IN_PROGRESS"] } } }),
    prisma.followUp.count({ where: { resident: { communityId }, status: { in: ["PENDING", "SCHEDULED", "OVERDUE"] } } }),
  ]);

  // ── Deterministic structured fields (real records, nothing invented) ──
  const medLine = (m: (typeof meds)[number]) => `${m.medication?.name ?? "medication"}${m.dosage ? ` ${m.dosage}` : ""}${m.route ? ` ${m.route}` : ""} — ${rn(m.resident)}`;
  const pick = (s: string) => meds.filter((m) => m.status === s);
  const given = pick("GIVEN"), partial = pick("PARTIAL"), held = pick("HELD"), refused = pick("REFUSED");
  const medsParts: string[] = [];
  if (given.length) medsParts.push(`Given: ${given.map(medLine).join("; ")}.`);
  if (partial.length) medsParts.push(`Partial: ${partial.map(medLine).join("; ")}.`);
  if (held.length) medsParts.push(`Held: ${held.map((m) => `${medLine(m)}${m.heldReason ? ` (${m.heldReason})` : ""}`).join("; ")}.`);
  if (refused.length) medsParts.push(`Refused: ${refused.map((m) => `${medLine(m)}${m.reasonForRefusal ? ` (${m.reasonForRefusal})` : ""}`).join("; ")}.`);
  const medicationsAdministered = medsParts.join(" ");

  const taskCompleted = tasksDone.map((t) => `${t.title} — ${rn(t.resident)}`).join("; ");
  const incidentsOccurred = incidents.length > 0;
  const incidentDetails = incidents.map((i) => `${String(i.severity)} ${String(i.incidentType).replace(/_/g, " ").toLowerCase()} — ${rn(i.resident)}: ${i.description}`).join(" | ");

  const updates: string[] = [];
  for (const e of escMine) updates.push(`Escalated (${String(e.priority)}) for ${rn(e.resident)}: ${e.situation} [${String(e.status)}]`);
  for (const c of comms) updates.push(`Contacted ${c.physicianName} (${String(c.method)}) re ${rn(c.resident)}: ${c.reason}`);
  const residentUpdates = updates.join(" | ");

  const carry: string[] = [];
  if (openEsc.length) carry.push(`${openEsc.length} open escalation(s): ${openEsc.slice(0, 5).map((e) => `${rn(e.resident)} — ${e.situation}`).join("; ")}${openEsc.length > 5 ? "…" : ""}.`);
  if (pendingTasks) carry.push(`${pendingTasks} pending task(s).`);
  if (dueFollowups) carry.push(`${dueFollowups} follow-up(s) due.`);
  const handoverNotes = carry.join(" ");

  const fields = { residentUpdates, incidentsOccurred, incidentDetails, medicationsAdministered, taskCompleted, handoverNotes };
  const empty = !medicationsAdministered && !taskCompleted && !incidentsOccurred && !residentUpdates && !handoverNotes;
  const shiftLabel = shiftType.charAt(0) + shiftType.slice(1).toLowerCase();

  const template = () =>
    empty
      ? `${shiftLabel} shift — no logged activity found for this window. Add any manual notes before submitting.`
      : `${shiftLabel} shift handover. ` + [
          medicationsAdministered && `Medications — ${medicationsAdministered}`,
          taskCompleted && `Tasks completed: ${taskCompleted}.`,
          incidentsOccurred && `Incidents: ${incidentDetails}.`,
          residentUpdates && `${residentUpdates}.`,
          handoverNotes && `Carry-over: ${handoverNotes}`,
        ].filter(Boolean).join(" ");

  let summary = template();
  let source = "generated";
  if (GEMINI_API_KEY && !empty) {
    const facts =
      `Shift: ${shiftLabel}\n` +
      (medicationsAdministered ? `Medications: ${medicationsAdministered}\n` : "") +
      (taskCompleted ? `Tasks completed: ${taskCompleted}\n` : "") +
      (incidentsOccurred ? `Incidents: ${incidentDetails}\n` : "") +
      (residentUpdates ? `Clinical actions: ${residentUpdates}\n` : "") +
      (handoverNotes ? `Open carry-over: ${handoverNotes}\n` : "");
    const systemInstruction =
      "You are a clinical assistant writing a professional end-of-shift endorsement (handover) for an " +
      "assisted-living facility, from the REAL logged activity provided. Write a clear, concise handover the " +
      "incoming shift can read in seconds: overall status, meds given/held/refused, incidents, clinical actions " +
      "(escalations, physician calls), and open items to carry over. 3-6 sentences, professional clinical tone. " +
      "Use ONLY the facts provided — do NOT invent residents, vitals, doses, or events. No headings, no bullet " +
      "markup, no preamble like 'Here is' — output only the endorsement.";
    try {
      const res = await fetch(`${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: facts }] }],
          // thinkingBudget:0 — gemini-2.5-flash "thinking" tokens count against
        // maxOutputTokens; without this the reasoning eats the budget and the
        // summary gets truncated mid-sentence.
        generationConfig: { temperature: 0.4, maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
        if (text) { summary = text; source = "gemini"; }
      } else {
        console.warn(`[AI Assistant shift-recap] Gemini ${res.status}`);
      }
    } catch (err) {
      console.warn("[AI Assistant shift-recap] network error", (err as Error).message);
    }
  }

  return NextResponse.json({ summary, fields, source, empty });
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
