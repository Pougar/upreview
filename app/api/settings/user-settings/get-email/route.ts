// app/api/settings/user-settings/get-email/route.ts
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
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPool;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReqBody = { userId?: string };

export async function POST(req: NextRequest) {
  try {
    const { userId } = (await req.json().catch(() => ({}))) as ReqBody;
    if (!userId) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }

    const pool = getPool();
    const q = await pool.query<{ email: string | null }>(
      `
      SELECT email
      FROM public.myusers
      WHERE betterauth_id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (q.rowCount === 0 || !q.rows[0]?.email) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json(
      {
        success: true,
        userId,
        email: q.rows[0].email,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[/api/settings/user-settings/get-email] error:", err?.stack || err);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "USE_POST", usage: "POST JSON: { userId: string }" },
    { status: 400 }
  );
}
