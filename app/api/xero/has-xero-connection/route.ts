import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import type { QueryResult } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reuse a single pool across hot reloads
const pool =
  (globalThis as any).__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined,
  });
(globalThis as any).__pgPool = pool;

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const betterauthId =
      url.searchParams.get("betterauth_id") ||
      url.searchParams.get("betterauthId") ||
      "";

    if (!betterauthId) {
      return NextResponse.json({ error: "Missing betterauth_id" }, { status: 400 });
    }

    // Is there at least one connected tenant for this user?
    type Row = { connected: boolean; tenant_count: number };
    const result: QueryResult<Row> = await pool.query(
      `
      SELECT
        (COUNT(*) FILTER (WHERE is_connected IS TRUE)) > 0 AS connected,
        COUNT(*)::int AS tenant_count
      FROM public.xero_details
      WHERE betterauth_id = $1
      `,
      [betterauthId]
    );

    const row = result.rows[0] || { connected: false, tenant_count: 0 };

    // no-store so the client always gets fresh truth
    return new NextResponse(
      JSON.stringify({ connected: row.connected === true, tenantCount: row.tenant_count || 0 }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (err: any) {
    console.error("[/api/xero/has-xero-connection] error:", err?.stack || err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
