// app/api/analytics/good-review-summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true }, // keep if your Neon setup has proper certs
});

// Helpers
function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
}

function sanitizeReview(text: string, maxLen = 800): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function dedupeKeepFirst(arr: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const k = s.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const userId = (body?.userId ?? "").trim();

    if (!userId) {
      return badRequest("Missing required field 'userId'.");
    }

    // Pull good reviews for this user
    // Note: uses COALESCE(updated_at, created_at) if present to bias recent first
    const { rows } = await pool.query<{ review: string | null }>(
      `
      SELECT review
      FROM clients
      WHERE user_id = $1
        AND sentiment = 'good'
        AND review IS NOT NULL
        AND length(btrim(review)) > 0
      ORDER BY COALESCE(updated_at, created_at) DESC
      LIMIT 500
      `,
      [userId]
    );

    // Prepare review texts (trim + dedupe)
    const reviewsRaw = rows
      .map((r) => r.review ?? "")
      .map((r) => sanitizeReview(r))
      .filter((r) => r.length > 0);

    const reviews = dedupeKeepFirst(reviewsRaw);

    if (reviews.length === 0) {
      return NextResponse.json({
        success: true,
        userId,
        count: 0,
        phrases: [],
      });
    }

    // Cap total characters to keep prompt manageable
    // Rough budget: ~50k chars
    const MAX_TOTAL_CHARS = 50000;
    const sliced: string[] = [];
    let total = 0;
    for (const r of reviews) {
      if (total + r.length > MAX_TOTAL_CHARS) break;
      sliced.push(r);
      total += r.length;
    }

    // Build structured prompt
    const prompt = `
You are given a JSON array of real customer reviews about a business. Identify the most common phrases/themes/sentiments customers repeatedly mention positively about the business.

INPUT_REVIEWS (JSON array):
${JSON.stringify(sliced, null, 2)}

TASK:
- Extract concise recurring phrases/themes (3–7 words each if possible).
- Focus on what customers praise (e.g., "friendly staff", "on-time service", "great value", "pain-free treatment").
- Avoid duplications, marketing fluff, or overly generic terms like "excellent service" unless clearly repeated.
- Prefer concrete aspects (speed, cleanliness, communication, follow-up, results, pricing clarity, etc.).
- Output about 7–15 items if enough evidence; fewer if not enough data.

STRICT OUTPUT FORMAT:
Return ONLY valid JSON with this exact shape (no markdown fences, no commentary):
{
  "phrases": ["<phrase1>", "<phrase2>", "..."]
}
`.trim();

    // Call Gemini
    const result = await generateText({
      model: google("gemini-2.5-flash"),
      prompt,
      temperature: 0.4, // keep it focused for summarization
    });

    // Parse model output
    let phrases: string[] = [];
    try {
      const raw = result.text.trim();
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      const json = JSON.parse(start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw);
      const arr = json?.phrases;
      if (Array.isArray(arr)) {
        phrases = arr.map((s: any) => String(s).trim()).filter(Boolean);
      }
    } catch {
      // Fallback: try to salvage line-based phrases if the model deviated
      const lines = result.text
        .replace(/^```json|```/g, "")
        .split(/\r?\n/)
        .map((l) => l.replace(/^[\-\*\d\.\)\s]+/, "").trim())
        .filter(Boolean);
      phrases = lines.slice(0, 15);
    }

    // Final tidy-up
    phrases = dedupeKeepFirst(
      phrases
        .map((p) => p.replace(/(^"|"$)/g, "").trim())
        .filter((p) => p.length > 0)
        .slice(0, 15)
    );

    return NextResponse.json({
      success: true,
      userId,
      count: reviews.length,
      phrases,
      // usage: result.usage, // uncomment if you want token info back
    });
  } catch (err: any) {
    console.error("[/api/analytics/good-review-summary] error:", err?.stack || err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function GET() {
  return badRequest("Use POST with JSON: { userId: string }");
}
