// app/api/settings/review-settings/add-phrases/route.ts
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
      // Neon typically needs SSL unless your URL has sslmode=require
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPool;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Sentiment = "good" | "bad";
type ReqPhrase =
  | string
  | {
      phrase?: string;
      sentiment?: Sentiment | string | null;
    };

type ReqBody = {
  userId?: string;
  phrases?: ReqPhrase[]; // strings or { phrase, sentiment }
};

type InputReview = { id: string; text: string };

function truncate(s: string, max = 800): string {
  return s.length <= max ? s : s.slice(0, max);
}
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function parseSentiment(s: unknown): Sentiment | null {
  const v = String(s ?? "").trim().toLowerCase();
  return v === "good" || v === "bad" ? (v as Sentiment) : null;
}

export async function POST(req: NextRequest) {
  try {
    const { userId, phrases } = (await req.json().catch(() => ({}))) as ReqBody;

    if (!userId) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }
    if (!Array.isArray(phrases) || phrases.length === 0) {
      return NextResponse.json({ error: "NO_PHRASES_GIVEN" }, { status: 400 });
    }

    // Normalize input into { phrase, sentiment|null }, trim & cap
    const normalized = phrases
      .map((p) => {
        if (typeof p === "string") {
          const phrase = p.trim().slice(0, 120);
          return phrase ? { phrase, sentiment: null as Sentiment | null } : null;
        } else if (p && typeof p === "object") {
          const phrase = String(p.phrase ?? "").trim().slice(0, 120);
          if (!phrase) return null;
          const s = parseSentiment(p.sentiment);
          return { phrase, sentiment: s };
        }
        return null;
      })
      .filter(Boolean) as { phrase: string; sentiment: Sentiment | null }[];

    if (normalized.length === 0) {
      return NextResponse.json({ error: "NO_VALID_PHRASES" }, { status: 400 });
    }

    // De-duplicate by lower-case phrase.
    // If multiple sentiments appear for the same phrase, prefer 'bad' > 'good' > null.
    const dedup = new Map<string, { phrase: string; sentiment: Sentiment | null }>();
    for (const item of normalized) {
      const key = item.phrase.toLowerCase();
      const prev = dedup.get(key);
      if (!prev) {
        dedup.set(key, item);
      } else {
        const prevS = prev.sentiment;
        const currS = item.sentiment;
        if (prevS === currS) continue;
        // Merge rule: bad > good > null
        const rank = (s: Sentiment | null) =>
          s === "bad" ? 2 : s === "good" ? 1 : 0;
        if (rank(currS) > rank(prevS)) {
          dedup.set(key, { phrase: prev.phrase, sentiment: currS });
        }
      }
    }
    const desiredItems = Array.from(dedup.values()); // [{ phrase, sentiment|null }]

    const pool = getPool();

    // ---- 1) Find which already exist (case-insensitive by phrase) ----
    const lcDesired = desiredItems.map((x) => x.phrase.toLowerCase());
    const existingQ = await pool.query<{ phrase: string }>(
      `
      SELECT phrase
      FROM public.phrases
      WHERE user_id = $1
        AND LOWER(phrase) = ANY($2::text[])
      `,
      [userId, lcDesired]
    );
    const existingLC = new Set(existingQ.rows.map((r) => r.phrase.toLowerCase()));
    const toCreateItems = desiredItems.filter(
      (x) => !existingLC.has(x.phrase.toLowerCase())
    );
    if (toCreateItems.length === 0) {
      return NextResponse.json(
        {
          success: true,
          userId,
          added: 0,
          skipped_existing: desiredItems.length,
          details: [],
          message: "All provided phrases already exist.",
        },
        { status: 200 }
      );
    }

    // ---- 2) Gather up to 100 most-recent reviews (internal + unlinked Google) ----
    const reviewsQ = await pool.query<{
      id: string;
      updated_at: string | null;
      created_at: string | null;
      text: string | null;
    }>(
      `
      SELECT
        r.id,
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
      updated_at: string | null;
      created_at: string | null;
      review: string | null;
    }>(
      `
      SELECT
        gr.id,
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

    const allWithTs = [
      ...reviewsQ.rows.map((r) => ({
        id: r.id,
        text: truncate(r.text ?? ""),
        ts: new Date(r.updated_at ?? r.created_at ?? "1970-01-01").getTime(),
      })),
      ...googleQ.rows.map((g) => ({
        id: g.id,
        text: truncate(g.review ?? ""),
        ts: new Date(g.updated_at ?? g.created_at ?? "1970-01-01").getTime(),
      })),
    ].filter((x) => x.text.length > 0);

    const recent = allWithTs
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 100)
      .map(({ ts, ...rest }) => rest);

    const joinedText = recent.map((r) => r.text).join("\n\n");

    // ---- 3) Ask Gemini to count appearances for each phrase ----
    const toCreatePhrases = toCreateItems.map((x) => x.phrase);
    const modelInput = {
      phrases: toCreatePhrases,
      reviews: recent.map((r) => ({ id: r.id, text: r.text })),
    };

    const instructions = `
You're given a small list of target phrases and up to 100 plain-text customer reviews.

For EACH target phrase, count how many times it appears across ALL review texts combined (case-insensitive).
- Count multiple occurrences in the same review separately.
- Do not hallucinate phrases or counts.
- Return integers >= 0.
- Output valid JSON only (no markdown; no commentary).

Strict JSON shape:
{
  "counts": [
    { "phrase": "<exact phrase from input.phrases>", "count": <integer> }
  ]
}
`.trim();

    const prompt = `
COUNT PHRASE OCCURRENCES

INPUT:
${JSON.stringify(modelInput, null, 2)}

GUIDANCE:
${instructions}
`.trim();

    let aiCountsMap = new Map<string, number>(); // key: lower(phrase)
    try {
      const aiRes = await generateText({
        model: google("gemini-2.5-flash"),
        prompt,
        temperature: 0.1,
      });

      const raw = aiRes.text?.trim() ?? "";
      const jsonStr = (() => {
        const s = raw.indexOf("{");
        const e = raw.lastIndexOf("}");
        return s !== -1 && e !== -1 ? raw.slice(s, e + 1) : raw;
      })();

      const parsed = JSON.parse(jsonStr) as {
        counts?: { phrase?: string; count?: number }[];
      };

      if (parsed && Array.isArray(parsed.counts)) {
        for (const row of parsed.counts) {
          const p = String(row?.phrase ?? "").trim();
          const cRaw: any = row?.count;
          const c =
            Number.isFinite(cRaw) ? Number(cRaw) : parseInt(String(cRaw ?? ""), 10);
          if (p && Number.isFinite(c) && c >= 0) {
            aiCountsMap.set(p.toLowerCase(), c);
          }
        }
      }
    } catch {
      // fall back to regex below
    }

    // ---- 4) Local fallback counts (regex, case-insensitive) ----
    const fallbackCounts = new Map<string, number>();
    for (const phrase of toCreatePhrases) {
      const pattern = new RegExp(escapeRegExp(phrase), "gi");
      const matches = joinedText.match(pattern);
      fallbackCounts.set(phrase.toLowerCase(), matches ? matches.length : 0);
    }

    // Final counts: prefer AI, else fallback
    const finalCounts = new Map<string, number>();
    for (const phrase of toCreatePhrases) {
      const key = phrase.toLowerCase();
      const aiVal = aiCountsMap.get(key);
      if (Number.isFinite(aiVal)) {
        finalCounts.set(key, Math.max(0, aiVal!));
      } else {
        finalCounts.set(key, fallbackCounts.get(key) ?? 0);
      }
    }

    // ---- 5) Insert new phrases with counts and sentiment-split ----
    const db = await pool.connect();
    const details: { phrase: string; counts: number; sentiment: Sentiment | null; inserted: boolean }[] = [];
    let added = 0;

    try {
      await db.query("BEGIN");

      for (const item of toCreateItems) {
        const { phrase, sentiment } = item;
        const cnt = finalCounts.get(phrase.toLowerCase()) ?? 0;
        const goodCnt = sentiment === "good" ? cnt : 0;
        const badCnt = sentiment === "bad" ? cnt : 0;

        try {
          await db.query(
            `
            INSERT INTO public.phrases
              (phrase, user_id, counts, good_count, bad_count, created_at, updated_at)
            VALUES
              ($1, $2, $3, $4, $5, NOW(), NOW())
            `,
            [phrase, userId, cnt, goodCnt, badCnt]
          );
          details.push({ phrase, counts: cnt, sentiment, inserted: true });
          added++;
        } catch {
          // Unique/race: skip
          details.push({ phrase, counts: cnt, sentiment, inserted: false });
        }
      }

      await db.query("COMMIT");
    } catch (e) {
      try { await db.query("ROLLBACK"); } catch {}
      return NextResponse.json({ error: "DB_WRITE_ERROR" }, { status: 500 });
    } finally {
      db.release();
    }

    // ---- 6) Done ----
    return NextResponse.json(
      {
        success: true,
        userId,
        requested: desiredItems.length,
        skipped_existing: desiredItems.length - toCreateItems.length,
        added,
        details,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[/api/settings/review-settings/add-phrases] error:", err?.stack || err);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
