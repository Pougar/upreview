// app/api/reviews/get-phrases/route.ts
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
      // Neon (and many hosted PGs) require SSL
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPool;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReqBody = {
  userId?: string;
  limit?: number;     // optional; default 1000, max 1000
  cursor?: string;    // optional; offset encoded as a string (e.g., "0", "1000")
};

type PhraseRow = {
  id: string;
  phrase: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const userId = (body.userId || "").trim();
    if (!userId) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }

    // Paging params
    const rawLimit = typeof body.limit === "number" ? body.limit : 1000;
    const limit = Math.min(Math.max(rawLimit, 1), 1000);

    const offset = (() => {
      const s = (body.cursor ?? "0").trim();
      const n = Number.parseInt(s, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    })();

    const pool = getPool();

    // Fetch just id and phrase, ordered by total mentions (good+bad), recency, and id
    const { rows } = await pool.query<PhraseRow>(
      `
      SELECT
        p.id,
        p.phrase
      FROM public.phrases p
      WHERE p.user_id = $1
      ORDER BY (COALESCE(p.good_count, 0) + COALESCE(p.bad_count, 0)) DESC,
               p.updated_at DESC NULLS LAST,
               p.id DESC
      LIMIT $2 OFFSET $3
      `,
      [userId, limit, offset]
    );

    // If we fetched 'limit' rows, there may be more.
    const nextCursor = rows.length === limit ? String(offset + rows.length) : null;

    // Normalize/truncate just in case (defensive)
    const payload = rows.map((r) => ({
      id: String(r.id),
      phrase: String(r.phrase ?? "").trim(),
    }));

    return NextResponse.json(
      {
        success: true,
        userId,
        count: payload.length,
        phrases: payload,        // [{ id, phrase }, ...]
        nextCursor,              // null when no more results
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[/api/analytics/get-phrases] error:", err?.stack || err);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(
    {
      error: "USE_POST",
      usage:
        "POST JSON: { userId: string, limit?: number (<=1000), cursor?: string (offset) }",
    },
    { status: 400 }
  );
}
