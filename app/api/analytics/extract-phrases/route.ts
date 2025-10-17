// app/api/analytics/extract-phrases/route.ts
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
  id: string;
  source: "reviews" | "google_reviews";
  is_unlinked_google: boolean;
  stars: number | null;
  text: string;
};

type GeminiPhraseOnly = {
  phrase: string;
  mention_count?: number; // integer mentions across all provided reviews
};
type GeminiOutput = {
  phrases: GeminiPhraseOnly[];
};

function truncate(s: string, max = 600): string {
  return s.length <= max ? s : s.slice(0, max);
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = (await req.json().catch(() => ({}))) as ReqBody;
    if (!userId) return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });

    const pool = getPool();

    // ---- 1) Gather inputs (latest first), cap to 100 total ----
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
        { success: true, message: "No reviews found to analyze.", phrases: [] },
        { status: 200 }
      );
    }

    // ---- 2) Build prompt (phrases only) ----
    const modelInput = {
      user_id: userId,
      reviews: inputs.map((i) => ({
        id: i.id,
        source: i.source,
        is_unlinked_google: i.is_unlinked_google,
        stars: i.stars,
        text: i.text,
      })),
    };

    const instructions = `
Task: Identify roughly 10 commonly discussed short phrases from the provided reviews.

Rules:
- Phrases should be concise and specific topics with clear sentiment (e.g., " great customer service", "short wait time", "clear pricing", "great communication"). Aim for human
expressions rather than customer experience (positive). These should be phrases people actually use.
- Return an estimated total "mention_count" (integer) for how many times each phrase appears across all reviews (case-insensitive).
- No excerpts are needed in this step.
- Use only valid JSON. No markdown fences.

STRICT OUTPUT SHAPE:
{
  "phrases": [
    { "phrase": "<short phrase>", "mention_count": 7 }
  ]
}
    `.trim();

    const prompt = `
You are extracting key phrases from reviews.

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

    // ---- 4) Parse + sanitize ----
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
      return NextResponse.json({ error: "MODEL_PARSE_ERROR", raw: raw.slice(0, 2000) }, { status: 502 });
    }
    if (!parsed || !Array.isArray(parsed.phrases)) {
      return NextResponse.json({ error: "BAD_MODEL_SHAPE" }, { status: 502 });
    }

    // Merge duplicates (case-insensitive)
    const merged = new Map<string, { phrase: string; counts: number }>();
    for (const p of parsed.phrases.slice(0, 14)) { // ~10 ±4
      const phrase = String(p?.phrase ?? "").trim().slice(0, 120);
      if (!phrase) continue;
      const key = phrase.toLowerCase();
      let counts = Number.isFinite(p?.mention_count) ? Number(p?.mention_count) : parseInt(String(p?.mention_count ?? ""), 10);
      if (!Number.isFinite(counts) || counts < 0) counts = 0;
      const prev = merged.get(key);
      if (!prev || counts > prev.counts) merged.set(key, { phrase, counts });
    }
    const groups = Array.from(merged.values());
    if (!groups.length) {
      return NextResponse.json({ success: true, message: "No usable phrases found.", phrases: [] }, { status: 200 });
    }

    // ---- 5) Upsert phrases (counts only). Do not touch excerpts. ----
    const db = await pool.connect();
    let created = 0;
    let updated = 0;
    try {
      await db.query("BEGIN");

      for (const g of groups) {
        const find = await db.query<{ id: string }>(
          `SELECT id FROM public.phrases WHERE user_id = $1 AND LOWER(phrase) = LOWER($2) LIMIT 1`,
          [userId, g.phrase]
        );

        if (find.rowCount) {
          await db.query(
            `UPDATE public.phrases
             SET counts = $1, updated_at = NOW()
             WHERE id = $2`,
            [g.counts, find.rows[0].id]
          );
          updated++;
        } else {
          await db.query(
            `INSERT INTO public.phrases (phrase, user_id, counts, good_count, bad_count, created_at, updated_at)
             VALUES ($1, $2, $3, 0, 0, NOW(), NOW())`,
            [g.phrase, userId, g.counts]
          );
          created++;
        }
      }

      await db.query("COMMIT");
    } catch (e) {
      try { await db.query("ROLLBACK"); } catch {}
      console.error("[extract-phrases] DB error:", e);
      return NextResponse.json({ error: "DB_WRITE_ERROR" }, { status: 500 });
    } finally {
      db.release();
    }

    return NextResponse.json(
      {
        success: true,
        userId,
        input_count: inputs.length,
        phrases_created: created,
        phrases_updated: updated,
        phrases: groups, // echo: [{ phrase, counts }]
        usage: result.usage ?? null,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[/api/analytics/extract-phrases] error:", err?.stack || err);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
