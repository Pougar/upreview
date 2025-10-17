// app/api/analytics/bad-review-summary/route.ts
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true }, // keep if your Neon setup has proper certs
});
// --- helpers ---
function badRequest(message: string, extra?: Record<string, unknown>) {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

function toCleanArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((s) => String(s ?? ""))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function dedupeCaseInsensitive(items: string[], max = 30, maxLen = 160): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of items) {
    const key = s.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s.length > maxLen ? s.slice(0, maxLen) : s);
      if (out.length >= max) break;
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = String((body?.userId ?? "") as string).trim();
    if (!userId) return badRequest("Missing 'userId'.");

    // Pull "bad" reviews for this user (ignore null/empty).
    // Limit for safety (adjust as needed).
    const { rows } = await pool.query<{ review: string }>(
      `
      SELECT review
      FROM clients
      WHERE user_id = $1
        AND sentiment = 'bad'
        AND review IS NOT NULL
        AND length(btrim(review)) > 0
      ORDER BY COALESCE(updated_at, created_at) DESC
      LIMIT 300
      `,
      [userId]
    );

    const reviews = rows.map((r) => r.review?.trim() ?? "").filter(Boolean);
    const reviewCount = reviews.length;

    // Short-circuit: no data
    if (reviewCount === 0) {
      return Response.json({
        success: true,
        userId,
        count: 0,
        phrases: [],
      });
    }

    // Keep prompt concise: cap to e.g. 150 reviews for token safety
    const LIMITED_REVIEWS = reviews.slice(0, 150);

    // Build a compact JSON-ish bundle to keep model grounded
    const reviewBlock =
      LIMITED_REVIEWS.map((r, i) => `- (${i + 1}) ${r.replace(/\s+/g, " ").slice(0, 600)}`).join("\n");

    const prompt = `
You are analyzing NEGATIVE Google reviews for a single business.

INPUT:
A list of actual customer reviews marked as "bad":
${reviewBlock}

TASK:
1) Read the reviews and identify recurring problems, pain points, dissatisfaction themes, and root causes.
2) Focus on concise phrases that capture what customers repeatedly complain about (e.g., "long wait times", "unexpected fees", "unresponsive support", "poor workmanship", "confusing booking").
3) Avoid repeating the same idea with slightly different wording; merge overlaps.
4) DO NOT invent details that are not present in the reviews.
5) Produce around 10–15 short, generalizable phrases if possible (fewer is fine if data is limited).

STRICT OUTPUT (JSON only; no markdown, no extra keys):
{
  "phrases": ["<short phrase 1>", "<short phrase 2>", "..."]
}
`.trim();

    const result = await generateText({
      model: google("gemini-2.5-flash"),
      prompt,
      temperature: 0.4, // a bit tighter for summarization
    });

    // Parse model output safely
    let phrases: string[] = [];
    try {
      const raw = result.text.trim();
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      const json = JSON.parse(start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw);
      phrases = toCleanArray(json?.phrases);
    } catch {
      // Soft fallback: split by lines if the model didn't obey strictly
      phrases = result.text
        .replace(/^```json|```/g, "")
        .split(/\n+/g)
        .map((s) => s.replace(/^[\s*-•\d.)]+/, "").trim())
        .filter(Boolean);
    }

    // Normalize + sanitize
    phrases = dedupeCaseInsensitive(phrases, 15, 120);

    return Response.json({
      success: true,
      userId,
      count: reviewCount,
      phrases,
      usage: result.usage,
    });
  } catch (err: any) {
    console.error("[/api/analytics/bad-review-summary] error:", err?.stack || err);
    return new Response(JSON.stringify({ error: "Failed to summarize bad reviews." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function GET() {
  return badRequest("Use POST with JSON: { userId: string }");
}
