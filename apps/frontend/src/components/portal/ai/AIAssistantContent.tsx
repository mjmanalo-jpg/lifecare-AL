"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Swal from "@/lib/swal";
import {
  Bot,
  Send,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Upload,
  FileText,
  Trash2,
  Sparkles,
  LoaderCircle,
  Database,
  X,
  Wand2,
  Save,
} from "lucide-react";
import {
  ASSISTANT_CONFIG_KEY,
  DEFAULT_ASSISTANT_CONFIG,
  TONE_OPTIONS,
  parseAssistantConfig,
  type AssistantConfig,
} from "@/lib/assistantConfig";
import {
  KnowledgeDoc,
  ingestFile,
  buildContext,
  totalBytes,
  formatBytes,
} from "@/lib/knowledgeBase";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, deleteRecord } from "@/lib/api";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  source?: string;
}

const KB_BUDGET = 4_500_000;

// Google (Gemini) prebuilt TTS voices — pick the assistant's voice from these.
interface GeminiVoice {
  id: string;
  desc: string;
  accent: string; // tailwind ring/text accent when selected
}
// Maps each Gemini voice to a distinct browser-voice config for the fallback
// path. Uses different name patterns + rate/pitch combos so voices sound
// perceptibly different even when Gemini TTS is unavailable.
// Patterns must name specific voices — a generic vendor word like "microsoft"
// previously matched "Microsoft David" and turned every female pick male.
const BROWSER_VOICE_MAP: Record<string, { namePattern?: RegExp; rate: number; pitch: number }> = {
  Zephyr:  { namePattern: /aria|samantha|zoe|female/i,   rate: 1.1, pitch: 1.15 },
  Puck:    { namePattern: /jenny|siri|female/i,          rate: 1.2, pitch: 1.3 },
  Charon:  { namePattern: /guy|david|daniel|male/i,      rate: 0.9, pitch: 0.85 },
  Kore:    { namePattern: /aria|jenny|zira|female/i,     rate: 0.95, pitch: 1.05 },
  Fenrir:  { namePattern: /guy|alex|fred|male/i,         rate: 1.05, pitch: 0.7 },
  Orus:    { namePattern: /ryan|george|tom|male/i,       rate: 0.85, pitch: 0.9 },
  Leda:    { namePattern: /jenny|samantha|female/i,      rate: 1.0,  pitch: 1.4 },
  Aoede:   { namePattern: /libby|michelle|veena|female/i, rate: 1.15, pitch: 1.2 },
};

// speechSynthesis.getVoices() is empty until the async voiceschanged event on
// first load — the old sync call then picked no voice and the OS default
// (often a robotic male voice) spoke instead. Wait for the list briefly.
function getBrowserVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const now = synth.getVoices();
    if (now.length) return resolve(now);
    const timer = setTimeout(() => resolve(synth.getVoices()), 1500);
    synth.onvoiceschanged = () => {
      clearTimeout(timer);
      resolve(synth.getVoices());
    };
  });
}

const GEMINI_VOICES: GeminiVoice[] = [
  { id: "Zephyr", desc: "Bright", accent: "amber" },
  { id: "Puck", desc: "Upbeat", accent: "orange" },
  { id: "Charon", desc: "Informative", accent: "sky" },
  { id: "Kore", desc: "Firm", accent: "yellow" },
  { id: "Fenrir", desc: "Excitable", accent: "red" },
  { id: "Leda", desc: "Youthful", accent: "pink" },
  { id: "Orus", desc: "Warm", accent: "emerald" },
  { id: "Aoede", desc: "Breezy", accent: "violet" },
];

// Full literal class strings so Tailwind's compiler keeps them (no dynamic names).
const ACCENT: Record<string, { on: string; dot: string }> = {
  amber: { on: "border-amber-400 bg-amber-50 ring-amber-400", dot: "bg-amber-400" },
  orange: { on: "border-orange-400 bg-orange-50 ring-orange-400", dot: "bg-orange-400" },
  sky: { on: "border-sky-400 bg-sky-50 ring-sky-400", dot: "bg-sky-400" },
  yellow: { on: "border-yellow-400 bg-yellow-50 ring-yellow-400", dot: "bg-yellow-400" },
  red: { on: "border-red-400 bg-red-50 ring-red-400", dot: "bg-red-400" },
  pink: { on: "border-pink-400 bg-pink-50 ring-pink-400", dot: "bg-pink-400" },
  emerald: { on: "border-emerald-400 bg-emerald-50 ring-emerald-400", dot: "bg-emerald-400" },
  violet: { on: "border-violet-400 bg-violet-50 ring-violet-400", dot: "bg-violet-400" },
};

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function AIAssistantContent() {
  // ── Chat state ─────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Hello — I'm your AI Assistant. Ask me anything, talk to me with the mic, or upload documents to my knowledge base and I'll answer from them.",
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);

  // ── Voice state ────────────────────────────────────────────────────────
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [voiceChat, setVoiceChat] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voice, setVoice] = useState("Kore"); // selected Google voice
  const [engine, setEngine] = useState<string>(""); // which TTS actually spoke

  // ── Knowledge base — live from Supabase/Prisma (realtime + polling) ──────
  const { data: docs, refetch: refetchDocs } = useLiveQuery<KnowledgeDoc>("knowledge-docs", {
    tables: ["KnowledgeDoc"],
  });
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // ── Voice preference — live from Supabase/Prisma (shared across sessions) ──
  const { data: settingRows } = useLiveQuery<{ id: string; value: string }>("app-settings", {
    tables: ["AppSetting"],
  });

  // ── Personality — shared config that drives every portal's assistant ─────
  const [config, setConfig] = useState<AssistantConfig>(DEFAULT_ASSISTANT_CONFIG);
  const [configDirty, setConfigDirty] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const voiceChatRef = useRef(false);
  const sendRef = useRef<(text: string) => void>(() => {});

  // Sync the selected voice from the shared DB setting when it changes.
  useEffect(() => {
    const saved = settingRows.find((r) => r.id === "assistantVoice")?.value;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing external DB state
    if (saved) setVoice(saved);
  }, [settingRows]);
  // Sync the personality config too — unless the admin has unsaved edits.
  useEffect(() => {
    const raw = settingRows.find((r) => r.id === ASSISTANT_CONFIG_KEY)?.value;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing external DB state
    if (raw && !configDirty) setConfig(parseAssistantConfig(raw));
  }, [settingRows, configDirty]);

  const editConfig = useCallback((patch: Partial<AssistantConfig>) => {
    setConfig((c) => ({ ...c, ...patch }));
    setConfigDirty(true);
  }, []);

  const saveConfig = useCallback(async () => {
    setSavingConfig(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: ASSISTANT_CONFIG_KEY, value: JSON.stringify(config) }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setConfigDirty(false);
      Swal.fire({
        icon: "success",
        title: "Personality updated",
        text: "Every portal assistant — including the resident companion — now uses it live.",
        timer: 2200,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Couldn't save personality",
        text: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSavingConfig(false);
    }
  }, [config]);
  useEffect(() => {
    voiceChatRef.current = voiceChat;
  }, [voiceChat]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  // ── Text-to-speech ─────────────────────────────────────────────────────
  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    async (text: string, voiceId?: string): Promise<void> => {
      if (!text) return;
      stopSpeaking();
      setSpeaking(true);

      // Google (Gemini) neural voice — falls back to browser speech if unavailable.
      try {
        const res = await fetch("/api/ai-assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "tts", text, provider: "auto", voiceId: voiceId ?? voice }),
        });
        const data = await res.json();
        if (!data.fallback && data.audio) {
          setEngine("gemini");
          const blob = base64ToBlob(data.audio, data.mimeType ?? "audio/mpeg");
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audioRef.current = audio;
          await new Promise<void>((resolve) => {
            audio.onended = () => {
              URL.revokeObjectURL(url);
              resolve();
            };
            audio.onerror = () => {
              URL.revokeObjectURL(url);
              resolve();
            };
            audio.play().catch(() => resolve());
          });
          setSpeaking(false);
          return;
        }
      } catch {
        /* fall through to browser speech */
      }

      // Browser Web Speech API fallback — uses distinct voice configs so each
      // selected Gemini voice sounds perceptibly different even via the browser.
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        setEngine("browser");
        const voices = await getBrowserVoices();
        await new Promise<void>((resolve) => {
          const u = new SpeechSynthesisUtterance(text);
          const cfg = BROWSER_VOICE_MAP[voiceId ?? voice] ?? BROWSER_VOICE_MAP.Kore;
          u.rate = cfg.rate;
          u.pitch = cfg.pitch;
          u.lang = "en-US";
          // Match the Gemini voice's name pattern first, then prefer the OS's
          // neural "Natural" voices (far less robotic), then any English voice.
          const preferred =
            (cfg.namePattern ? voices.find((v) => cfg.namePattern!.test(v.name) && v.lang.startsWith("en")) : null) ??
            voices.find((v) => /natural/i.test(v.name) && v.lang.startsWith("en")) ??
            voices.find((v) => v.lang === "en-US") ??
            voices.find((v) => v.lang.startsWith("en")) ??
            null;
          if (preferred) u.voice = preferred;
          u.onend = () => resolve();
          u.onerror = () => resolve();
          window.speechSynthesis.speak(u);
        });
      }
      setSpeaking(false);
    },
    [voice, stopSpeaking]
  );

  // Select a voice, preview it, and persist the choice to Supabase (shared).
  const chooseVoice = useCallback(
    (id: string) => {
      setVoice(id);
      speak(`Hi, I'm ${id}. This is how I'll sound in US English.`, id);
      fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "assistantVoice", value: id }),
      }).catch(() => {});
    },
    [speak]
  );

  // ── Speech-to-text (browser Web Speech API) ────────────────────────────
  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      Swal.fire({
        icon: "info",
        title: "Voice input unavailable",
        text: "Your browser doesn't support live speech recognition. Chrome or Edge is recommended.",
      });
      return;
    }
    stopSpeaking();
    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognitionRef.current = recognition;

    let finalText = "";
    recognition.onresult = (e: any) => {
      let interim = "";
      finalText = "";
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }
      setInput(finalText || interim);
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      const text = finalText.trim();
      if (text && voiceChatRef.current) {
        sendRef.current(text);
      }
    };
    recognition.onerror = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    setListening(true);
    recognition.start();
  }, [stopSpeaking]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  // ── Send a chat message ────────────────────────────────────────────────
  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || thinking) return;
      setInput("");
      const userMsg: Message = { id: `u-${Date.now()}`, role: "user", text };
      setMessages((m) => [...m, userMsg]);
      setThinking(true);

      const context = buildContext(text, docs);
      const history = messages
        .filter((m) => m.id !== "welcome")
        .slice(-10)
        .map((m) => ({ role: m.role === "assistant" ? "model" : "user", text: m.text }));

      let reply = "";
      let source = "offline";
      try {
        const res = await fetch("/api/ai-assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "chat", message: text, context, history, audience: "admin" }),
        });
        const data = await res.json();
        reply = data.reply || "Sorry, I couldn't generate a response.";
        source = data.source || "offline";
      } catch {
        reply = "I couldn't reach the assistant service. Please try again.";
      }

      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: "assistant", text: reply, source }]);
      setThinking(false);

      if (autoSpeak || voiceChatRef.current) {
        await speak(reply);
        if (voiceChatRef.current) startListening(); // hands-free loop
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, thinking, autoSpeak, speak, docs]
  );
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const toggleMic = () => (listening ? stopListening() : startListening());

  const toggleVoiceChat = () => {
    const next = !voiceChat;
    setVoiceChat(next);
    setAutoSpeak(next);
    if (next) startListening();
    else {
      stopListening();
      stopSpeaking();
    }
  };

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (audioRef.current) audioRef.current.pause();
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  // ── Knowledge base uploads → persisted in Supabase/Prisma ──────────────
  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        setUploading(file.name);
        try {
          const doc = await ingestFile(file);
          await createRecord("knowledge-docs", doc);
          await refetchDocs();
        } catch (err) {
          await Swal.fire({
            icon: "error",
            title: `Couldn't add "${file.name}"`,
            text: err instanceof Error ? err.message : "Unknown error",
          });
        } finally {
          setUploading(null);
        }
      }
    },
    [refetchDocs]
  );

  const handleRemove = async (doc: KnowledgeDoc) => {
    const res = await Swal.fire({
      title: "Remove document?",
      text: `"${doc.name}" will be removed from the knowledge base.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      confirmButtonText: "Remove",
    });
    if (res.isConfirmed) {
      try {
        await deleteRecord("knowledge-docs", doc.id);
        await refetchDocs();
      } catch (err) {
        await Swal.fire({
          icon: "error",
          title: "Couldn't remove document",
          text: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }
  };

  const used = totalBytes(docs);
  const usedPct = Math.min(100, Math.round((used / KB_BUDGET) * 100));

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2 flex items-center gap-2">
            <Sparkles className="w-8 h-8 text-yellow-500" />
            AI Assistant
          </h1>
          <p className="text-gray-600">
            Chat, talk, and listen — grounded in your facility knowledge base.
          </p>
        </div>
      </div>

      {/* ── AI Voice picker — 8 Google (Gemini) voices ─────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Volume2 className="w-4 h-4 text-yellow-500" />
          <p className="text-sm font-bold text-gray-800">AI Voice</p>
          <span className="text-xs text-gray-400">Neural AI voices — tap a voice to preview it</span>
          {engine === "gemini" && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
              AI voice active
            </span>
          )}
          {engine === "browser" && (
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"
              title="Cloud AI voice unreachable — using the browser's built-in voice, so the voice cards may sound similar until it reconnects."
            >
              ⚠ Basic voice mode
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {GEMINI_VOICES.map((v) => {
            const selected = voice === v.id;
            const a = ACCENT[v.accent];
            return (
              <button
                key={v.id}
                onClick={() => chooseVoice(v.id)}
                className={`relative flex items-center gap-3 rounded-xl border p-3 text-left transition active:scale-[0.98] ${
                  selected ? `${a.on} ring-1` : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <span
                  className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                    selected ? a.dot : "bg-gray-100"
                  }`}
                >
                  {selected && speaking ? (
                    <Volume2 className="w-4 h-4 text-white animate-pulse" />
                  ) : (
                    <Mic className={`w-4 h-4 ${selected ? "text-white" : "text-gray-400"}`} />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-gray-800 truncate">{v.id}</span>
                  <span className="block text-xs text-gray-500">{v.desc}</span>
                </span>
                {selected && (
                  <span className="absolute top-1.5 right-2 text-xs font-bold text-gray-500">✓</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Personality — live-synced to every portal's assistant ──────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Wand2 className="w-4 h-4 text-yellow-500" />
          <p className="text-sm font-bold text-gray-800">Personality</p>
          <span className="text-xs text-gray-400">
            Applies in realtime to this assistant and the resident dashboard companion
          </span>
          {configDirty && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              Unsaved changes
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Assistant name</label>
              <input
                value={config.name}
                onChange={(e) => editConfig({ name: e.target.value })}
                placeholder="e.g. Sunny"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Tone</label>
              <div className="grid grid-cols-2 gap-2">
                {TONE_OPTIONS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => editConfig({ tone: t.id })}
                    className={`rounded-xl border p-2.5 text-left transition active:scale-[0.98] ${
                      config.tone === t.id
                        ? "border-yellow-400 bg-yellow-50 ring-1 ring-yellow-400"
                        : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <span className="block text-sm font-semibold text-gray-800">{t.label}</span>
                    <span className="block text-xs text-gray-500">{t.desc}</span>
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={config.useEmoji}
                onChange={(e) => editConfig({ useEmoji: e.target.checked })}
                className="w-4 h-4 rounded accent-yellow-400"
              />
              Allow a light sprinkle of emoji
            </label>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Greeting shown to residents
              </label>
              <textarea
                value={config.greeting}
                onChange={(e) => editConfig({ greeting: e.target.value })}
                rows={3}
                placeholder="Hi there! I'm Sunny, your AI companion…"
                className="w-full resize-none border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Extra instructions <span className="font-normal text-gray-400">(optional — house rules, menus, reminders…)</span>
              </label>
              <textarea
                value={config.instructions}
                onChange={(e) => editConfig({ instructions: e.target.value })}
                rows={3}
                placeholder="e.g. Bingo is every Friday 3pm in the sunroom. Dinner is served 5:30–7pm."
                className="w-full resize-none border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
              />
            </div>
            <div className="flex justify-end">
              <button
                onClick={saveConfig}
                disabled={savingConfig || !configDirty}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-black text-sm font-semibold hover:shadow-lg transition disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
              >
                {savingConfig ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save personality
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Chat column ─────────────────────────────────────────────── */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 flex flex-col h-[70vh] overflow-hidden">
          {/* header */}
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-yellow-50 to-white">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <Bot className="w-5 h-5 text-black" />
              </div>
              <div>
                <p className="font-bold text-gray-900 leading-tight">{config.name || "AI Assistant"}</p>
                <p className="text-xs text-gray-500 flex items-center gap-1">
                  {speaking ? (
                    <><Volume2 className="w-3 h-3 text-yellow-600 animate-pulse" /> speaking…</>
                  ) : listening ? (
                    <><Mic className="w-3 h-3 text-red-500 animate-pulse" /> listening…</>
                  ) : (
                    <>{docs.length} doc{docs.length === 1 ? "" : "s"} in knowledge base</>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => (speaking ? stopSpeaking() : setAutoSpeak((s) => !s))}
                title={autoSpeak ? "Auto-speak on" : "Auto-speak off"}
                className={`p-2 rounded-lg transition ${
                  autoSpeak ? "bg-yellow-100 text-yellow-700" : "text-gray-400 hover:bg-gray-100"
                }`}
              >
                {autoSpeak ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
              </button>
              <button
                onClick={toggleVoiceChat}
                title="Hands-free voice chat"
                className={`px-3 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-1.5 ${
                  voiceChat
                    ? "bg-red-500 text-white hover:bg-red-600"
                    : "bg-gray-900 text-white hover:bg-gray-800"
                }`}
              >
                {voiceChat ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                {voiceChat ? "Stop" : "Voice Chat"}
              </button>
            </div>
          </div>

          {/* messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-gradient-to-br from-blue-500 to-indigo-600 text-black rounded-br-sm"
                      : "bg-gray-100 text-gray-800 rounded-bl-sm"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  {m.role === "assistant" && m.id !== "welcome" && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <button
                        onClick={() => speak(m.text)}
                        className="text-xs text-gray-400 hover:text-yellow-600 flex items-center gap-1"
                      >
                        <Volume2 className="w-3 h-3" /> Play
                      </button>
                      {m.source && m.source !== "offline" && (
                        <span className="text-[10px] uppercase tracking-wide text-gray-300">AI</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            )}
          </div>

          {/* composer */}
          <div className="border-t border-gray-100 p-3">
            <div className="flex items-end gap-2">
              <button
                onClick={toggleMic}
                title={listening ? "Stop listening" : "Speak"}
                className={`p-3 rounded-xl transition flex-shrink-0 ${
                  listening
                    ? "bg-red-500 text-white animate-pulse"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {listening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={1}
                placeholder="Type a message, or tap the mic to speak…"
                className="flex-1 resize-none border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none max-h-32"
              />
              <button
                onClick={() => send(input)}
                disabled={!input.trim() || thinking}
                className="p-3 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-black hover:shadow-lg transition disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0 active:scale-95"
              >
                {thinking ? <LoaderCircle className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* ── Knowledge base column ────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 flex flex-col h-[70vh] overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2 bg-gradient-to-r from-blue-50 to-white">
            <Database className="w-5 h-5 text-blue-500" />
            <div>
              <p className="font-bold text-gray-900 leading-tight">Knowledge Base</p>
              <p className="text-xs text-gray-500">{docs.length} document{docs.length === 1 ? "" : "s"} · {formatBytes(used)}</p>
            </div>
          </div>

          {/* dropzone */}
          <div className="p-4">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition ${
                dragOver ? "border-yellow-400 bg-yellow-50" : "border-gray-300 hover:border-yellow-400 hover:bg-gray-50"
              }`}
            >
              {uploading ? (
                <div className="flex flex-col items-center gap-2 text-yellow-600">
                  <LoaderCircle className="w-6 h-6 animate-spin" />
                  <p className="text-xs font-medium truncate max-w-full">Reading {uploading}…</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1 text-gray-500">
                  <Upload className="w-6 h-6 text-gray-400" />
                  <p className="text-sm font-medium text-gray-700">Drop files or click to upload</p>
                  <p className="text-[11px] text-gray-400">PDF, Word, images, TXT, MD, CSV, JSON, code…</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
            </div>
            {/* storage bar */}
            <div className="mt-3">
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${usedPct > 90 ? "bg-red-500" : "bg-yellow-400"}`}
                  style={{ width: `${usedPct}%` }}
                />
              </div>
              <p className="text-[10px] text-gray-400 mt-1 text-right flex items-center justify-end gap-1">
                <Database className="w-3 h-3" /> Synced to Supabase · {usedPct}% of context budget
              </p>
            </div>
          </div>

          {/* doc list */}
          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
            {docs.length === 0 ? (
              <div className="text-center text-gray-400 py-10">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No documents yet.</p>
                <p className="text-xs">Upload files and the assistant will answer from them.</p>
              </div>
            ) : (
              docs.map((doc) => (
                <div key={doc.id} className="group flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4 text-blue-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{doc.name}</p>
                    <p className="text-[11px] text-gray-400">
                      {formatBytes(doc.size)} · {doc.chars.toLocaleString()} chars
                      {doc.source === "cloud" && " · AI-extracted"}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRemove(doc)}
                    className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition opacity-0 group-hover:opacity-100"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Global speaking indicator / stop */}
      {speaking && (
        <button
          onClick={stopSpeaking}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-full shadow-lg hover:bg-gray-800 transition"
        >
          <X className="w-4 h-4" /> Stop speaking
        </button>
      )}
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────
function base64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
