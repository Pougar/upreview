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
  counts: number;
  sentiment: Sentiment;
};

export async function POST(req: NextRequest) {
  try {
    const { userId } = (await req.json().catch(() => ({}))) as ReqBody;
    if (!userId) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }

    const pool = getPool();

    // Get ALL phrases for this user — no LIMIT, no “ensure a bad phrase”.
    const q = await pool.query<PhraseRow>(
      `
      SELECT
        p.id,
        p.phrase,
        COALESCE(p.counts, 0)                      AS counts,
        COALESCE(p.sentiment, 'good')::text        AS sentiment   -- default to 'good' if null
      FROM public.phrases p
      WHERE p.user_id = $1
      ORDER BY COALESCE(p.counts, 0) DESC,
               p.updated_at DESC NULLS LAST,
               p.id DESC
      `,
      [userId]
    );

    const items = q.rows.map((r) => ({
      phrase_id: r.id,
      phrase: r.phrase,
      sentiment: r.sentiment as Sentiment,
      total_count: r.counts, // optional extra; keep if useful to you
    }));

    return NextResponse.json(
      {
        success: true,
        userId,
        count: items.length,
        phrases: items,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[/api/settings/review-settings/get-phrases] error:", err?.stack || err);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
