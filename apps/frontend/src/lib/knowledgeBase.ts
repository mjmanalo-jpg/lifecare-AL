"use client";

/**
 * Knowledge base for the AI Assistant — now persisted in Supabase via Prisma.
 *
 * Documents live in the `KnowledgeDoc` table and are read through the generic
 * /api/db/knowledge-docs endpoint + useLiveQuery (realtime + polling), so every
 * admin session sees the same knowledge base and updates appear live. This file
 * handles the client-side concerns: turning an uploaded file into stored text,
 * and scoring chunks against a question for retrieval-augmented chat.
 */

// A row as stored in / returned from the database.
export interface KnowledgeDoc {
  id: string;
  name: string;
  type: string;
  size: number;
  chars: number;
  text: string;
  source: "client" | "cloud";
  createdAt?: string;
}

// The payload we POST to create a new document (DB fills id/createdAt).
export type NewKnowledgeDoc = Omit<KnowledgeDoc, "id" | "createdAt">;

// ── File classification ──────────────────────────────────────────────────
// Formats the browser can read as text with zero dependencies.
const TEXT_EXTENSIONS =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|log|xml|html?|css|js|jsx|ts|tsx|py|java|c|cpp|cs|go|rb|php|sql|yaml|yml|ini|env|sh|bat|rtf|srt|vtt)$/i;
const TEXT_MIME = /^(text\/|application\/(json|xml|javascript|x-yaml|x-sh|sql))/;

export function isTextFile(file: File): boolean {
  return TEXT_MIME.test(file.type) || TEXT_EXTENSIONS.test(file.name);
}

// ── Extraction ───────────────────────────────────────────────────────────────
function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsText(file);
  });
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Turn an uploaded file into a document payload ready to persist.
 *  - text formats  → read locally (works offline)
 *  - everything else (pdf, images, docx…) → server extraction via Gemini
 */
export async function ingestFile(file: File): Promise<NewKnowledgeDoc> {
  let text = "";
  let source: KnowledgeDoc["source"] = "client";

  if (isTextFile(file)) {
    text = await readAsText(file);
  } else {
    const base64 = await readAsBase64(file);
    const res = await fetch("/api/ai-assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "extract",
        base64,
        mimeType: file.type || "application/octet-stream",
        filename: file.name,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.reason || data.error || "Could not extract text from this file.");
    }
    text = String(data.text ?? "");
    source = "cloud";
  }

  text = text.trim();
  if (!text) throw new Error("No readable text found in this file.");

  return {
    name: file.name,
    type: file.type || "unknown",
    size: file.size,
    chars: text.length,
    text,
    source,
  };
}

// ── Retrieval (lightweight RAG) ──────────────────────────────────────────────
interface Chunk {
  docName: string;
  text: string;
}

function chunkText(doc: KnowledgeDoc, size = 900): Chunk[] {
  const chunks: Chunk[] = [];
  const clean = (doc.text ?? "").replace(/\s+/g, " ").trim();
  for (let i = 0; i < clean.length; i += size) {
    chunks.push({ docName: doc.name, text: clean.slice(i, i + size) });
  }
  return chunks;
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "to", "of",
  "in", "on", "for", "with", "what", "who", "how", "when", "where", "why", "do",
  "does", "can", "you", "me", "my", "our", "this", "that", "it", "please", "tell",
]);

function keywords(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Build a grounding-context string for a question by picking the highest-scoring
 * chunks across all documents. Returns "" when nothing relevant is found.
 */
export function buildContext(query: string, docs: KnowledgeDoc[], maxChars = 6000): string {
  if (!docs.length) return "";
  const words = keywords(query);
  const chunks = docs.flatMap((d) => chunkText(d));

  const scored = chunks
    .map((c) => {
      const lc = c.text.toLowerCase();
      const score = words.reduce((n, w) => (lc.includes(w) ? n + 1 : n), 0);
      return { c, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // No keyword hits → fall back to the start of each doc so the model still has
  // some grounding (e.g. "summarize the documents").
  const picked = scored.length
    ? scored.map((s) => s.c)
    : docs.map((d) => ({ docName: d.name, text: (d.text ?? "").slice(0, 1200) }));

  const out: string[] = [];
  let used = 0;
  for (const c of picked) {
    const block = `[${c.docName}]\n${c.text}`;
    if (used + block.length > maxChars) break;
    out.push(block);
    used += block.length;
  }
  return out.join("\n\n");
}

export function totalBytes(docs: KnowledgeDoc[]): number {
  return docs.reduce((n, d) => n + (d.chars ?? 0), 0);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
