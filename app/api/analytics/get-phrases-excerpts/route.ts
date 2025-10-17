import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

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
      // Neon typically needs SSL unless the URL has sslmode=require
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPool;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReqBody = { userId?: string };
type Sentiment = "good" | "bad";

type PhraseRow = {
  id: string;
  phrase: string;
  total_count: number;
  is_bad_dominant: boolean;
  phrase_sentiment: string | null; // from SQL; normalized later
  created_at: string | null;
};

type ExcerptRow = {
  id: string;
  phrase_id: string;
  happy: boolean | null;
  excerpt: string;
  review_id: string | null;
  g_review_id: string | null;
  created_at: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const { userId } = (await req.json().catch(() => ({}))) as ReqBody;
    if (!userId) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }

    const pool = getPool();

    // 1) Get candidate phrases for this user, ordered by total mentions.
    const phrasesRes = await pool.query<PhraseRow>(
      `
      SELECT
        p.id,
        p.phrase,
        COALESCE(p.counts, 0)                  AS total_count,
        COALESCE(p.sentiment = 'bad', false)   AS is_bad_dominant,
        p.sentiment::text                      AS phrase_sentiment,
        p.created_at                           AS created_at
      FROM public.phrases p
      WHERE p.user_id = $1
      ORDER BY COALESCE(p.counts, 0) DESC,
               p.updated_at DESC NULLS LAST,
               p.id DESC
      LIMIT 50
      `,
      [userId]
    );

    let candidates = phrasesRes.rows;

    if (!candidates.length) {
      return NextResponse.json(
        { success: true, userId, count: 0, phrases: [] },
        { status: 200 }
      );
    }

    // 2) Pick top N, ensure at least one 'bad' phrase if available.
    const TOP_N = 50;
    let chosen = candidates.slice(0, TOP_N);

    const hasBadDominant = chosen.some((p) => p.is_bad_dominant);
    if (!hasBadDominant) {
      const extraBad = candidates.find(
        (p) => p.is_bad_dominant && !chosen.some((c) => c.id === p.id)
      );
      if (extraBad) {
        const sortedAsc = [...chosen].sort((a, b) => a.total_count - b.total_count);
        const toDrop = sortedAsc[0];
        chosen = chosen.filter((p) => p.id !== toDrop.id);
        chosen.push(extraBad);
      }
    }

    // Keep deterministic order by total_count DESC
    chosen.sort((a, b) => b.total_count - a.total_count);

    const phraseIds = chosen.map((p) => p.id);

    // 3) Fetch excerpts for the chosen phrases
    const exRes = await pool.query<ExcerptRow>(
      `
      SELECT
        e.id,
        e.phrase_id,
        e.happy,
        e.excerpt,
        e.review_id,
        e.g_review_id,
        e.created_at
      FROM public.excerpts e
      WHERE e.phrase_id = ANY($1::text[])
      ORDER BY e.created_at DESC NULLS LAST, e.id DESC
      `,
      [phraseIds]
    );

    const byPhrase = new Map<string, ExcerptRow[]>();
    for (const e of exRes.rows) {
      if (!byPhrase.has(e.phrase_id)) byPhrase.set(e.phrase_id, []);
      byPhrase.get(e.phrase_id)!.push(e);
    }

    // 4) Build response payload
    const payload = chosen.map((p) => {
      const ex = byPhrase.get(p.id) || [];
      const excerpts = ex.map((row) => ({
        excerpt_id: row.id,
        excerpt: row.excerpt,
        sentiment: row.happy === true ? ("good" as Sentiment) : ("bad" as Sentiment),
        review_id: row.review_id,
        g_review_id: row.g_review_id,
        is_unlinked_google: row.g_review_id !== null,
        created_at: row.created_at,
      }));

      // Normalize `phrase_sentiment` to "good" | "bad" for the client
      const normalizedSentiment: Sentiment =
        p.phrase_sentiment === "bad" ? "bad" : "good";

      return {
        phrase_id: p.id,
        phrase: p.phrase,
        sentiment: normalizedSentiment,
        total_count: p.total_count,
        created_at: p.created_at,
        excerpts,
      };
    });

    return NextResponse.json(
      {
        success: true,
        userId,
        count: payload.length,
        phrases: payload,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[/api/analytics/get-phrases-excerpts] error:", err?.stack || err);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
