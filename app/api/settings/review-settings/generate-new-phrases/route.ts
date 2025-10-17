// app/api/settings/review-settings/generate-new-phrases/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";

/** ---------- PG Pool (singleton across hot reloads) ---------- */
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
      // Neon typically needs SSL unless your URL already has sslmode=require
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPool;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReqBody = { userId?: string };

type InputItem = {
  id: string;                         // reviews.id or google_reviews.id
  source: "reviews" | "google_reviews";
  is_unlinked_google: boolean;        // true only for unlinked google_reviews
  stars: number | null;               // 0..5 or null
  text: string;                       // chosen review text
};

type Sentiment = "good" | "bad";

type GeminiPhrase = {
  phrase: string;
  mention_count?: number; // total mentions across provided reviews
  sentiment?: Sentiment | string; // model should send good|bad, but we coerce
};

type GeminiOutput = {
  phrases: GeminiPhrase[];
};

function truncate(s: string, max = 600): string {
  return s.length <= max ? s : s.slice(0, max);
}

function parseSentiment(s: unknown): Sentiment | null {
  const v = String(s ?? "").trim().toLowerCase();
  return v === "good" || v === "bad" ? (v as Sentiment) : null;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = (await req.json().catch(() => ({}))) as ReqBody;
    if (!userId) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }

    const pool = getPool();

    // ---- 1) Gather inputs (latest first), cap to 100 total ----
    // Reviews: choose text by isPrimary
    const reviewsQ = await pool.query<{
      id: string;
      stars: number | null;
      updated_at: string | null;
      created_at: string | null;
      text: string | null;
    }>(
      `
      SELECT
        r.id,
        r.stars,
        r.updated_at,
        r.created_at,
        CASE
          WHEN r."isPrimary" = 'google'::review_primary_source
            THEN NULLIF(BTRIM(r.google_review), '')
          ELSE NULLIF(BTRIM(r.review), '')
        END AS text
      FROM public.reviews r
      WHERE r.user_id = $1
        AND (
          CASE
            WHEN r."isPrimary" = 'google'::review_primary_source
              THEN NULLIF(BTRIM(r.google_review), '')
            ELSE NULLIF(BTRIM(r.review), '')
          END
        ) IS NOT NULL
      `,
      [userId]
    );

    // Unlinked Google reviews
    const googleQ = await pool.query<{
      id: string;
      stars: number | null;
      updated_at: string | null;
      created_at: string | null;
      review: string | null;
    }>(
      `
      SELECT
        gr.id,
        gr.stars,
        gr.updated_at,
        gr.created_at,
        NULLIF(BTRIM(gr.review), '') AS review
      FROM public.google_reviews gr
      WHERE gr.user_id = $1
        AND gr.linked = FALSE
        AND NULLIF(BTRIM(gr.review), '') IS NOT NULL
      `,
      [userId]
    );

    const inputsWithTs = [
      ...reviewsQ.rows.map((r) => ({
        id: r.id,
        source: "reviews" as const,
        is_unlinked_google: false,
        stars: r.stars,
        text: truncate(r.text ?? ""),
        ts: new Date(r.updated_at ?? r.created_at ?? "1970-01-01").getTime(),
      })),
      ...googleQ.rows.map((g) => ({
        id: g.id,
        source: "google_reviews" as const,
        is_unlinked_google: true,
        stars: g.stars,
        text: truncate(g.review ?? ""),
        ts: new Date(g.updated_at ?? g.created_at ?? "1970-01-01").getTime(),
      })),
    ].filter((x) => x.text.length > 0);

    const inputs: InputItem[] = inputsWithTs
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 100)
      .map(({ ts, ...rest }) => rest);

    if (!inputs.length) {
      return NextResponse.json(
        { success: true, message: "No reviews found to analyze.", new_phrases: [], userId },
        { status: 200 }
      );
    }

    // ---- 2) Build prompt for Gemini (phrases-only + mention_count + sentiment) ----
    const modelInput = {
      user_id: userId,
      reviews: inputs.map((i) => ({
        id: i.id,
        source: i.source,                    // "reviews" | "google_reviews"
        is_unlinked_google: i.is_unlinked_google,
        stars: i.stars,
        text: i.text,
      })),
    };

    const instructions = `
Task: Read the provided reviews and propose ~10 short "phrases" (topics) commonly discussed.
- Phrases should be concise and specific topics with a clear good or bad sentiment (e.g., "great customer service", "short wait time", "clear pricing", "great communication").
- Aim for natural expressions (not generic labels).

For EACH phrase, provide:
- "phrase": short text (≤ 120 chars).
- "mention_count": INTEGER equal to how many times this phrase is mentioned across ALL provided reviews (case-insensitive).
  Count multiple mentions within the same review too.
- "sentiment": "good" or "bad" based on the overall sentiment of the phrase in context of the reviews.

Rules:
- Output must be VALID JSON ONLY (no Markdown fences or prose).
- Avoid near-duplicates; prefer one canonical wording.
- Keep phrases general, not full sentences.

Strict output JSON shape:
{
  "phrases": [
    { "phrase": "<short phrase>", "mention_count": 5, "sentiment": "good" }
  ]
}
`.trim();

    const prompt = `
You are extracting candidate phrases from reviews.

INPUT:
${JSON.stringify(modelInput, null, 2)}

GUIDANCE:
${instructions}
`.trim();

    // ---- 3) Call Gemini ----
    const result = await generateText({
      model: google("gemini-2.5-flash"),
      prompt,
      temperature: 0.2,
    });

    // ---- 4) Parse + normalize model output ----
    const raw = result.text.trim();
    const jsonStr = (() => {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      return start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw;
    })();

    let parsed: GeminiOutput;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json(
        { error: "MODEL_PARSE_ERROR", raw: raw.slice(0, 2000) },
        { status: 502 }
      );
    }
    if (!parsed || !Array.isArray(parsed.phrases)) {
      return NextResponse.json({ error: "BAD_MODEL_SHAPE" }, { status: 502 });
    }

    // Merge duplicates (case-insensitive), sanitize lengths, coerce counts & sentiment
    type Accum = { phrase: string; counts: number; sentiment: Sentiment | null };
    const merged = new Map<string, Accum>(); // key = lower(phrase)

    for (const p of parsed.phrases.slice(0, 20)) {
      const phrase = String(p?.phrase ?? "").trim().slice(0, 120);
      if (!phrase) continue;

      let cnt = Number.isFinite(p?.mention_count)
        ? Number(p!.mention_count)
        : parseInt(String((p as any)?.mention_count ?? ""), 10);
      if (!Number.isFinite(cnt) || cnt < 0) cnt = 0;

      const s = parseSentiment((p as any)?.sentiment);

      const key = phrase.toLowerCase();

      if (!merged.has(key)) {
        merged.set(key, { phrase, counts: cnt, sentiment: s });
      } else {
        // Combine: keep the larger count; for sentiment, choose the one from the higher count
        const curr = merged.get(key)!;

        // choose max counts
        const maxCounts = Math.max(curr.counts, cnt);
        // decide sentiment: prefer the sentiment attached to the max count;
        // if tie or both null, bias to 'bad' (conservative), else keep existing.
        let chosenSentiment = curr.sentiment;
        if (cnt > curr.counts) {
          chosenSentiment = s ?? chosenSentiment;
        } else if (cnt === curr.counts) {
          if (curr.sentiment !== s) {
            chosenSentiment = (curr.sentiment && s)
              ? ("bad" as Sentiment) // tie + conflict -> bad
              : (curr.sentiment ?? s ?? null);
          }
        }
        curr.counts = maxCounts;
        curr.sentiment = chosenSentiment;
      }
    }

    const candidates = Array.from(merged.values())
      // Optionally drop items with missing/invalid sentiment
      .filter((c) => c.sentiment === "good" || c.sentiment === "bad");

    if (!candidates.length) {
      return NextResponse.json(
        { success: true, message: "Model returned no usable phrases.", new_phrases: [], userId },
        { status: 200 }
      );
    }

    // ---- 5) Compare to existing phrases for this user (case-insensitive) ----
    const existingQ = await pool.query<{ phrase: string }>(
      `
      SELECT phrase
      FROM public.phrases
      WHERE user_id = $1
      `,
      [userId]
    );
    const existingSet = new Set(
      existingQ.rows.map((r) => String(r.phrase || "").trim().toLowerCase()).filter(Boolean)
    );

    // Compare by phrase text only; if you want to allow the same phrase with different
    // sentiments as separate rows, change this to include (phrase+sentiment).
    const newPhrases = candidates.filter((c) => !existingSet.has(c.phrase.toLowerCase()));

    // ---- 6) Return ONLY new phrases to the client (no DB writes here) ----
    return NextResponse.json(
      {
        success: true,
        userId,
        input_count: inputs.length,
        suggested_count: candidates.length,
        existing_skipped: candidates.length - newPhrases.length,
        new_phrases: newPhrases.map((p) => ({
          phrase: p.phrase,
          counts: p.counts,           // aligns with your phrases table column "counts"
          sentiment: p.sentiment,     // <-- NEW: "good" | "bad"
        })),
        usage: result.usage ?? null,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[/api/settings/review-settings/generate-new-phrases] error:", err?.stack || err);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
