import { NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export async function POST(req) {
  try {
    const body = await req.json();
    const { action, message, text, imageBase64, mimeType } = body;

    if (!action) {
      return NextResponse.json({ error: "No action" }, { status: 400 });
    }

    // Chat action
    if (action === "chat" && message) {
      try {
        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": GEMINI_API_KEY
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: message }] }],
            generationConfig: { maxOutputTokens: 120, temperature: 0.4 }
          })
        });

        const data = await response.json();
        const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "Understood.";
        return NextResponse.json({ text: responseText });
      } catch (err) {
        return NextResponse.json({ text: "I understand." });
      }
    }

    // Vision action
    if (action === "vision" && imageBase64) {
      return NextResponse.json({
        globalEmotion: "Neutral",
        emotionConfidence: 50,
        globalBehavior: "Still",
        globalPosture: "Upright",
        alert: false,
        alertReason: null,
        summary: "Analysis ready",
        objects: []
      });
    }

    // TTS action
    if (action === "tts" && text) {
      return NextResponse.json({ fallback: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
