// app/api/reviews/generate-good-reviews/route.ts
import { NextRequest } from "next/server";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* =========================
   PG Pool (singleton)
========================= */
declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}
function getPool(): Pool {
  if (!global._pgPool) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPool = new Pool({
      connectionString: cs,
      // Neon typically needs SSL unless the URL already has sslmode=require
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPool;
}

/* =========================
   Helpers
========================= */
function badRequest(message: string, extra?: Record<string, unknown>) {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

// Split strings on common delimiters and normalise
function toStringArrayFlexible(input: unknown): string[] {
  if (Array.isArray(input)) return input.map((s) => String(s));
  if (typeof input === "string") {
    return input.split(/[|,\n;\r]+/g).map((s) => s.trim());
  }
  return [];
}

function normaliseItems(input: unknown): string[] {
  const raw = toStringArrayFlexible(input);
  const trimmed = raw.map((s) => s.trim()).filter((s) => s.length > 0);
  // de-dup (case-insensitive, keep first casing)
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const s of trimmed) {
    const key = s.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(s);
    }
  }
  // cap count and per-item length
  const MAX_ITEMS = 15;
  const MAX_LEN = 120;
  return deduped.slice(0, MAX_ITEMS).map((s) => (s.length > MAX_LEN ? s.slice(0, MAX_LEN) : s));
}

/* =========================
   Route
========================= */

type Body = {
  userId?: string;    // required
  clientId?: string;  // required ("test" allowed for tester mode)
  phrases?: string[]; // required (1..10)
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const userId = String(body?.userId ?? "").trim();
  const clientId = String(body?.clientId ?? "").trim();
  const phrasesRaw = Array.isArray(body?.phrases) ? body!.phrases : [];

  if (!userId) return badRequest("Field 'userId' is required.");
  if (!clientId) return badRequest("Field 'clientId' is required.");

  // Validate phrases (1..10)
  if (!phrasesRaw.length) return badRequest("Field 'phrases' must have 1–10 items.");
  if (phrasesRaw.length > 10) return badRequest("No more than 10 phrases allowed.");
  const phrases = phrasesRaw.map((p) => String(p || "").trim()).filter(Boolean);
  if (!phrases.length) return badRequest("All phrases were empty after trimming.");

  const pool = getPool();

  // 1) Load company context from myusers using betterauth_id = userId
  const userQ = await pool.query<{
    display_name: string | null;
    description: string | null;
  }>(
    `
    SELECT display_name, description
    FROM public.myusers
    WHERE betterauth_id = $1
    LIMIT 1
    `,
    [userId]
  );

  if (userQ.rowCount === 0) {
    return badRequest("USER_NOT_FOUND", { userId });
  }

  const company = (userQ.rows[0].display_name || "").trim();
  const descriptionRaw = (userQ.rows[0].description || "").trim();
  // keep description manageable for prompt hygiene
  const description = descriptionRaw ? descriptionRaw.slice(0, 1200) : "";

  if (!company) {
    return badRequest("DISPLAY_NAME_MISSING_FOR_USER", { userId });
  }

  // 2) Load client line items (unless tester mode)
  let itemDescriptions: string[] = [];
  if (clientId !== "test") {
    const clientQ = await pool.query<{ item_description: string | null }>(
      `
      SELECT item_description
      FROM public.clients
      WHERE id = $1
      LIMIT 1
      `,
      [clientId]
    );

    if (clientQ.rowCount === 0) {
      return badRequest("CLIENT_NOT_FOUND", { clientId });
    }

    itemDescriptions = normaliseItems(clientQ.rows[0].item_description || "");
  } else {
    // tester mode: proceed without items
    itemDescriptions = [];
  }

  // 3) Build the model prompt (unchanged stylistically, but now data-driven)
  const list = phrases.map((p) => `- ${p}`).join("\n");
  const descBlock = description
    ? `\nBusiness context (owner-provided — use naturally, don't copy verbatim):\n"${description}"\n`
    : "";

  const itemsBlock = itemDescriptions.length
    ? `\nItems/services (from invoice):\n${itemDescriptions.map((i) => `- ${i}`).join("\n")}\n`
    : "";

  const prompt = `
You are writing realistic, positive Google reviews.

Company: "${company}"
${descBlock}${itemsBlock}
Requested aspects to (naturally) highlight in at least one review:
${list}

Guidelines:
- Produce two distinct reviews that feel human and specific, not generic or over-the-top.
- It's okay to use only some of the phrases—keep it natural.
- Use the items/services list to ground details where appropriate; do not invent specifics beyond what's implied.
- Keep tone sincere and credible; avoid marketing fluff.

Please make each review roughly 75 words.

STRICT OUTPUT FORMAT:
Return ONLY valid JSON (no markdown fences, no extra text) with this shape:
{
  "review_1": "<first review as a single string>",
  "review_2": "<second review as a single string>"
}
`.trim();

  try {
    const result = await generateText({
      model: google("gemini-2.5-flash"),
      prompt,
      temperature: 0.9,
    });

    // Parse model output as JSON (tolerant to stray fences)
    let r1 = "";
    let r2 = "";
    try {
      const raw = (result.text || "").trim();
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      const json = JSON.parse(start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw);
      r1 = String(json.review_1 ?? "").trim();
      r2 = String(json.review_2 ?? "").trim();
    } catch {
      // Fallback: naive split if JSON parsing fails.
      const raw = (result.text || "")
        .replace(/^```json|```/g, "")
        .replace(/review[_\s-]*1:\s*/i, "")
        .replace(/review[_\s-]*2:\s*/i, "");
      const parts = raw.split(/\n{2,}|(?:^|\n)---+(?:\n|$)/).filter(Boolean);
      r1 = (parts[0] ?? "").trim();
      r2 = (parts[1] ?? "").trim();
    }

    if (!r1 || !r2) {
      return new Response(
        JSON.stringify({
          error: "Model returned an unexpected format.",
          raw: result.text,
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    return Response.json({
      userId,
      clientId,
      company,
      description: description || null,
      phrases,
      itemDescriptions,
      reviews: [r1, r2],
      usage: result.usage,
    });
  } catch (err: any) {
    console.error("Gemini error:", err);
    return new Response(JSON.stringify({ error: "Failed to generate reviews." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function GET() {
  return badRequest(
    "Use POST with JSON: { userId: string, clientId: string, phrases: string[1..10] }"
  );
}
