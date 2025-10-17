// app/api/analytics/get-graph-info/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

/** ---------- PG Pool (singleton across hot reloads) ---------- */
declare global {
  // eslint-disable-next-line no-var
  var _pgPoolGraphInfo: Pool | undefined;
}

function getPool(): Pool {
  if (!global._pgPoolGraphInfo) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPoolGraphInfo = new Pool({
      connectionString: cs,
      // Neon uses SSL; keep this unless your URL already sets sslmode=require
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPoolGraphInfo;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReqBody = {
  userId?: string;   // primary key name used across your app
  user_id?: string;  // accepted for convenience
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const userId = body.userId || body.user_id;

    if (!userId) {
      return NextResponse.json({ success: false, error: "MISSING_USER_ID" }, { status: 400 });
    }

    const pool = getPool();

    // We aggregate per UTC day on the DB side for both sources,
    // then union and re-aggregate to get final per-day good/bad counts.
    //
    // reviews: good if happy = true, bad if happy = false
    // google_reviews: include only linked = false; good if stars >= 3, bad if stars < 3
    //
    // DATE handling: use timezone('UTC', created_at)::date to normalize days in UTC.
    const sql = `
      WITH r AS (
        SELECT
          timezone('UTC', created_at)::date AS day,
          SUM(CASE WHEN happy IS TRUE  THEN 1 ELSE 0 END)::bigint AS good,
          SUM(CASE WHEN happy IS FALSE THEN 1 ELSE 0 END)::bigint AS bad
        FROM public.reviews
        WHERE user_id = $1
        GROUP BY 1
      ),
      g AS (
        SELECT
          timezone('UTC', created_at)::date AS day,
          SUM(CASE WHEN stars IS NOT NULL AND stars >= 3 THEN 1 ELSE 0 END)::bigint AS good,
          SUM(CASE WHEN stars IS NOT NULL AND stars < 3  THEN 1 ELSE 0 END)::bigint AS bad
        FROM public.google_reviews
        WHERE user_id = $1 AND linked = FALSE
        GROUP BY 1
      ),
      u AS (
        SELECT day, good, bad FROM r
        UNION ALL
        SELECT day, good, bad FROM g
      )
      SELECT
        to_char(day, 'YYYY-MM-DD') AS date,
        SUM(good)::bigint AS good_count,
        SUM(bad)::bigint  AS bad_count
      FROM u
      GROUP BY 1
      ORDER BY 1;
    `;

    const q = await pool.query<{ date: string; good_count: string; bad_count: string }>(sql, [userId]);

    // Output as requested: list of (Date, good_count, bad_count)
    const points = q.rows.map((r) => [r.date, Number(r.good_count), Number(r.bad_count)] as [string, number, number]);

    return NextResponse.json(
      {
        success: true,
        userId,
        points, // [ "YYYY-MM-DD", good_count, bad_count ]
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("[/api/analytics/get-graph-info] error:", err?.stack || err);
    return NextResponse.json({ success: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
