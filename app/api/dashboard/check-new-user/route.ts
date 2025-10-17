// app/api/dashboard/check-new-user/route.ts
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

type ReqBody = { user_id?: string; userId?: string };

type Row = {
  created_at: string | null;
  older_than_week: boolean | null;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const userId = body.user_id || body.userId;

    if (!userId) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }

    const pool = getPool();
    const q = await pool.query<Row>(
      `
      SELECT
        created_at,
        (created_at <= NOW() - INTERVAL '7 days') AS older_than_week
      FROM public.myusers
      WHERE betterauth_id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (q.rowCount === 0) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    const row = q.rows[0];
    const olderThanWeek = !!row.older_than_week; // coerce null -> false

    return NextResponse.json(
      {
        success: true,
        userId,
        older_than_week: olderThanWeek, // true if created_at > 7 days ago, else false
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[/api/dashboard/check-new-user] error:", err?.stack || err);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
