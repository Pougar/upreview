// app/api/analytics/make-excerpts/route.ts
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

type GeminiExcerpt = {
  excerpt: string;
  sentiment: "good" | "bad";
  review_id: string;
  is_unlinked_google: boolean;
};

type GeminiPhraseGroup = {
  phrase: string;
  excerpts: GeminiExcerpt[];
};
type GeminiOutput = { phrases: GeminiPhraseGroup[] };

function truncate(s: string, max = 600): string {
  return s.length <= max ? s : s.slice(0, max);
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = (await req.json().catch(() => ({}))) as ReqBody;
    if (!userId) return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });

    const pool = getPool();

    // ---- 1) Load phrases for this user (most recent first). If none, bail. ----
    const phrasesQ = await pool.query<{ id: string; phrase: string }>(
      `
      SELECT id, phrase
      FROM public.phrases
      WHERE user_id = $1
      ORDER BY updated_at DESC NULLS LAST, counts DESC NULLS LAST, id DESC
      LIMIT 20
      `,
      [userId]
    );
    if (phrasesQ.rowCount === 0) {
      return NextResponse.json(
        { error: "NO_PHRASES", message: "Run /api/analytics/extract-phrases first." },
        { status: 400 }
      );
    }

    const phraseMap = new Map<string, { id: string; phrase: string }>(); // key = lower(phrase)
    const phraseList = phrasesQ.rows.map((p) => {
      phraseMap.set(p.phrase.toLowerCase(), { id: p.id, phrase: p.phrase });
      return p.phrase;
    });

    // ---- 2) Prepare 100 latest reviews (internal + unlinked Google) ----
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

    // Allowed ID sets for validation
    const allowedReviewIds = new Set(inputs.filter(i => i.source === "reviews").map(i => i.id));
    const allowedGoogleIds = new Set(inputs.filter(i => i.source === "google_reviews").map(i => i.id));

    // ---- 3) Build prompt (excerpts for given phrases) ----
    const modelInput = {
      user_id: userId,
      phrases: phraseList,   // authoritative list of phrases to use
      reviews: inputs.map((i) => ({
        id: i.id,
        source: i.source,
        is_unlinked_google: i.is_unlinked_google,
        stars: i.stars,
        text: i.text,
      })),
    };

    const instructions = `
Task: For each provided phrase, return 3–6 short excerpts (≈1 sentence) from the reviews where the phrase is clearly mentioned.

Rules:
- Excerpts must include:
  - "excerpt" (short span of copied text),
  - "sentiment": "good" | "bad",
  - "review_id": one of the provided review IDs,
  - "is_unlinked_google": true if the excerpt came from an unlinked Google review.
- Prefer the most clearly positive/negative excerpts; if sentiment is unclear, skip it.
- Star ratings may be used as weak hints (5★ rarely negative; ≤2★ rarely positive).
- Keep JSON valid; no markdown fences.

STRICT OUTPUT SHAPE:
{
  "phrases": [
    {
      "phrase": "<one of the provided phrases>",
      "excerpts": [
        {
          "excerpt": "<short sentence excerpt>",
          "sentiment": "good" | "bad",
          "review_id": "<id from input.reviews[i].id>",
          "is_unlinked_google": true | false
        }
      ]
    }
  ]
}
    `.trim();

    const prompt = `
You are extracting excerpts for known phrases.

INPUT:
${JSON.stringify(modelInput, null, 2)}

GUIDANCE:
${instructions}
`.trim();

    // ---- 4) Call Gemini ----
    const result = await generateText({
      model: google("gemini-2.5-flash"),
      prompt,
      temperature: 0.2,
    });

    // ---- 5) Parse + validate ----
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

    // Sanitize, keep only phrases we supplied; clip to 3–6 excerpts
    const cleanGroups: { phrase_id: string; phrase: string; excerpts: GeminiExcerpt[] }[] = [];
    for (const g of parsed.phrases) {
      const phrase = String(g?.phrase ?? "").trim().slice(0, 120);
      if (!phrase) continue;

      const match = phraseMap.get(phrase.toLowerCase());
      if (!match) continue; // ignore phrases we didn't supply

      const normalized: GeminiExcerpt[] = (Array.isArray(g.excerpts) ? g.excerpts : [])
        .slice(0, 6)
        .map((e): GeminiExcerpt | null => {
          const sentiment: "good" | "bad" = e?.sentiment === "good" ? "good" : "bad";
          const rid = String(e?.review_id ?? "").trim();
          const fromGoogle = !!e?.is_unlinked_google;
          if (!rid) return null;
          if (fromGoogle && !allowedGoogleIds.has(rid)) return null;
          if (!fromGoogle && !allowedReviewIds.has(rid)) return null;
          return {
            excerpt: String(e?.excerpt ?? "").trim().slice(0, 350),
            sentiment,
            review_id: rid,
            is_unlinked_google: fromGoogle,
          };
        })
        .filter((e): e is GeminiExcerpt => !!e && e.excerpt.length > 0);

      if (normalized.length) {
        cleanGroups.push({ phrase_id: match.id, phrase: match.phrase, excerpts: normalized.slice(0, 6) });
      }
    }

    if (!cleanGroups.length) {
      return NextResponse.json(
        { success: true, message: "Model returned no usable excerpts.", phrases: [] },
        { status: 200 }
      );
    }

    // ---- 6) Overwrite excerpts per phrase, insert new ones, recompute good/bad counts ----
    const db = await pool.connect();
    let phrasesTouched = 0;
    let insertedExcerpts = 0;

    try {
      await db.query("BEGIN");

      for (const g of cleanGroups) {
        // Overwrite: delete existing excerpts for this phrase
        await db.query(`DELETE FROM public.excerpts WHERE phrase_id = $1`, [g.phrase_id]);

        // Insert new excerpts
        for (const e of g.excerpts) {
          const happy = e.sentiment === "good";
          const reviewId = e.is_unlinked_google ? null : e.review_id;
          const gReviewId = e.is_unlinked_google ? e.review_id : null;

          await db.query(
            `
            INSERT INTO public.excerpts (phrase_id, user_id, happy, excerpt, review_id, g_review_id, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
            `,
            [g.phrase_id, userId, happy, e.excerpt, reviewId, gReviewId]
          );
          insertedExcerpts++;
        }
        phrasesTouched++;
      }

      // Recompute counts for all touched phrases
      const affected = cleanGroups.map((g) => g.phrase_id);
      await db.query(
        `
        WITH sums AS (
          SELECT
            phrase_id,
            SUM(CASE WHEN happy IS TRUE  THEN 1 ELSE 0 END)::int AS good_count,
            SUM(CASE WHEN happy IS FALSE THEN 1 ELSE 0 END)::int AS bad_count
          FROM public.excerpts
          WHERE phrase_id = ANY($1)
          GROUP BY phrase_id
        )
        UPDATE public.phrases p
        SET good_count = COALESCE(s.good_count, 0),
            bad_count  = COALESCE(s.bad_count, 0),
            updated_at = NOW()
        FROM sums s
        WHERE p.id = s.phrase_id
        `,
        [affected]
      );

      await db.query("COMMIT");
    } catch (e) {
      try { await db.query("ROLLBACK"); } catch {}
      console.error("[make-excerpts] DB error:", e);
      return NextResponse.json({ error: "DB_WRITE_ERROR" }, { status: 500 });
    } finally {
      db.release();
    }

    return NextResponse.json(
      {
        success: true,
        userId,
        input_count: inputs.length,
        phrases_updated: phrasesTouched,
        excerpts_inserted: insertedExcerpts,
        usage: result.usage ?? null,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[/api/analytics/make-excerpts] error:", err?.stack || err);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
