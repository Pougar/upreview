// app/api/xero/list-businesses/route.ts
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
  isPrimary: boolean | null;
};

export async function POST(req: Request) {
  try {
    // Allow explicit userId; otherwise derive from the current session.
    const session = await auth.api.getSession({ headers: req.headers as any }).catch(() => null);
    const body = (await req.json().catch(() => ({}))) as { userId?: string };
    const userId = body?.userId ?? session?.user?.id;

    if (!userId) {
      return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const pool = getPool();

    // Return one row per tenant_name. If duplicate rows exist, prefer the most recent;
    // if there's a tie, prefer the one marked isPrimary=true.
    const { rows } = await pool.query<Row>(
      `
      SELECT DISTINCT ON (xd.tenant_name)
             xd.tenant_name,
             xd.isprimary AS "isPrimary"
      FROM public.xero_details xd
      WHERE xd.betterauth_id = $1
      ORDER BY xd.tenant_name,
               xd.isprimary DESC,
               COALESCE(xd.updated_at, xd.created_at) DESC
      `,
      [userId],
    );

    return NextResponse.json({
      success: true,
      userId,
      count: rows.length,
      businesses: rows.map(r => ({
        tenant_name: r.tenant_name,
        isPrimary: !!r.isPrimary,
      })),
    });
  } catch (err: any) {
    console.error("[POST /api/xero/list-businesses] Error:", err?.message || err);
    return NextResponse.json({ success: false, error: "Server error" }, { status: 500 });
  }
}
