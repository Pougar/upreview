// app/api/xero/get-primary-business/route.ts
import { NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

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

type Row = {
  tenant_name: string | null;
};

export async function POST(req: Request) {
  try {
    // Auth: allow explicit userId, otherwise fall back to current session
    const session = await auth.api.getSession({ headers: req.headers as any }).catch(() => null);
    const body = (await req.json().catch(() => ({}))) as { userId?: string };
    const userId = body?.userId ?? session?.user?.id;

    if (!userId) {
      return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const pool = getPool();

    // Fetch the most-recent primary tenant for this BetterAuth user
    const { rows } = await pool.query<Row>(
      `
      SELECT tenant_name
      FROM public.xero_details
      WHERE betterauth_id = $1
        AND isPrimary IS TRUE
      ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, tenant_name ASC
      LIMIT 1
      `,
      [userId],
    );

    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        userId,
        tenant_name: null,
        message: "No primary Xero tenant set for this user.",
      });
    }

    return NextResponse.json({
      success: true,
      userId,
      tenant_name: rows[0].tenant_name,
    });
  } catch (err: any) {
    console.error("[POST /api/xero/get-primary-business] Error:", err?.message || err);
    return NextResponse.json({ success: false, error: "Server error" }, { status: 500 });
  }
}
