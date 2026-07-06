import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const SYSTEM_PROMPT = `You are a concise AI care assistant embedded in the Golden Hearth assisted-living facility dashboard.
You help nurses and caregivers with quick, brief answers about resident health, vitals, medications, safety, and daily care.
Resident context: Arthur Pendelton is in Suite 12A. He is 78 years old, assisted living level.
- Normal heart rate: 72 bpm
- Blood pressure: 118/75 mmHg
- Oxygen: 98%
- Temperature: normal
- Medication: Morning Insulin (08:00), Vitamin D (12:00)
Keep responses to 1-2 sentences. Be direct and clinical.`;
const VISION_PROMPT = `You are a real-time AI vision system for a medical assisted-living facility monitoring camera.
Analyze the image and respond ONLY with a valid JSON object. No markdown, no explanation, just JSON.

Return exactly this shape:
{
  "globalEmotion": "one of: Happy | Sad | Neutral | Angry | Surprised | Fearful | Disgusted | Distressed | Content | Calm",
  "emotionConfidence": number 0-100,
  "globalBehavior": "one of: Waving | Moving | Still | Resting | Exercising | Gesturing | Talking | Looking Around | Falling | Seated",
  "globalPosture": "one of: Upright | Seated | Leaning Forward | Leaning Back | Prone | Slouching | Standing | Lying Down",
  "alert": true or false — true ONLY if person appears to be falling, unconscious, in severe pain, or in immediate distress,
  "alertReason": "string description if alert true, else null",
  "summary": "one concise sentence max 12 words describing the scene",
  "objects": [
    {
      "type": "exact label: person | chair | couch | phone | bed | cup | book | remote | laptop | tv | cat | dog | bottle | bag | etc.",
      "thought": "2-5 word AI observation — what this object/person is doing or its safety relevance",
      "risk": "low | medium | high"
    }
  ]
}

CRITICAL RULES:
1. Pay close attention to the person's face to accurately detect their emotion (e.g. if they look angry, frustrated, happy, smiling, sad, or neutral).
2. For the objects array, identify ONLY the primary person and at most 2 other highly relevant objects (like a phone, cup, or laptop in use). Do NOT list background furniture, walls, or TVs. Keep the objects array small (max 3 items total) to prevent truncated responses.`;
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === "chat") {
      const { message } = body;
      if (!message?.trim()) return NextResponse.json({ error: "No message" }, { status: 400 });

      const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
      const result = await genai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: message }] }],
        config: { systemInstruction: SYSTEM_PROMPT, maxOutputTokens: 120, temperature: 0.4 },
      });

      return NextResponse.json({ text: result.text ?? "Understood." });
    }

    if (action === "vision") {
      const { imageBase64, mimeType = "image/jpeg" } = body;
      if (!imageBase64) return NextResponse.json({ error: "No image provided" }, { status: 400 });

      try {
        const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
        const result = await genai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType, data: imageBase64 } },
                { text: VISION_PROMPT },
              ],
            },
          ],
          config: {
            temperature: 0.2,
            maxOutputTokens: 1024,
            responseMimeType: "application/json",
          },
        });

        const rawText = result.text?.trim() ?? "{}";

        // Strip markdown code fences if Gemini wraps in ```json ... ```
        const cleaned = rawText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

        try {
          const parsed = JSON.parse(cleaned);
          return NextResponse.json(parsed);
        } catch (err: any) {
          console.error("Failed to parse Gemini vision response:", err?.message, "Raw response:", rawText);
          return NextResponse.json({
            globalEmotion: "Neutral",
            emotionConfidence: 50,
            globalBehavior: "Still",
            globalPosture: "Upright",
            alert: false,
            alertReason: null,
            summary: "Analysis in progress...",
            objects: [],
          });
        }
      } catch (visionErr: any) {
        console.error("[/api/gemini] Vision error:", visionErr?.message ?? visionErr);
        return NextResponse.json({
          globalEmotion: "Neutral",
          emotionConfidence: 50,
          globalBehavior: "Still",
          globalPosture: "Upright",
          alert: false,
          alertReason: null,
          summary: "Camera analysis unavailable",
          objects: [],
        }, { status: 500 });
      }
    }

    if (action === "tts") {
      const { text } = body;
      if (!text?.trim()) return NextResponse.json({ error: "No text" }, { status: 400 });

      const model = process.env.GEMINI_TTS_MODEL ?? "gemini-2.5-flash-preview-tts";
      const voice = process.env.GEMINI_TTS_VOICE ?? "Kore";

      const result = await genai.models.generateContent({
        model,
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      });

      const audioPart = result.candidates?.[0]?.content?.parts?.find(
        (p: any) => p.inlineData?.mimeType?.startsWith("audio/")
      );

      if (!audioPart?.inlineData) return NextResponse.json({ fallback: true });

      return NextResponse.json({ audio: audioPart.inlineData.data, mimeType: audioPart.inlineData.mimeType });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    console.error("[/api/gemini]", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Gemini error" }, { status: 500 });
  }
}
