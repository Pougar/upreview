// app/api/analytics/avg-email-to-click/route.ts
import { NextResponse } from "next/server";
import { Pool } from "pg";

/** ---------- PG Pool (singleton across hot reloads) ---------- */
declare global {
  // eslint-disable-next-line no-var
  var _pgPool_avgEmailToClick: Pool | undefined;
}
function getPool(): Pool {
  if (!global._pgPool_avgEmailToClick) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPool_avgEmailToClick = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPool_avgEmailToClick;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/analytics/avg-email-to-click
 * Body: { userId: string }
 *
 * Logic:
 *  1) Get all client IDs for the user.
 *  2) For each client, take the MOST-RECENT email_sent time (sent_at).
 *  3) Find the EARLIEST link_clicked that happened AT OR AFTER that sent_at (click_at).
 *  4) If both exist for a client, diff = click_at - sent_at.
 *  5) Return average of these diffs across all such clients.
 */
export async function POST(req: Request) {
  try {
    const { userId } = await req.json().catch(() => ({}));
    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId (string) is required" }, { status: 400 });
    }

    const pool = getPool();

    const q = await pool.query<{
      pair_count: string | null;   // numeric comes back as string
      avg_seconds: string | null;  // numeric comes back as string
    }>(`
      WITH user_clients AS (
        SELECT c.id
        FROM public.clients c
        WHERE c.user_id = $1
      ),
      last_sent AS (
        SELECT ca.client_id, MAX(ca.created_at) AS sent_at
        FROM public.client_actions ca
        WHERE ca.client_id IN (SELECT id FROM user_clients)
          AND ca.action = 'email_sent'
        GROUP BY ca.client_id
      ),
      first_click_after AS (
        SELECT ca.client_id, MIN(ca.created_at) AS click_at
        FROM public.client_actions ca
        JOIN last_sent s
          ON s.client_id = ca.client_id
        WHERE ca.action = 'link_clicked'
          AND ca.created_at >= s.sent_at
        GROUP BY ca.client_id
      ),
      pairs AS (
        SELECT
          s.client_id,
          s.sent_at,
          f.click_at,
          EXTRACT(EPOCH FROM (f.click_at - s.sent_at))::numeric AS diff_seconds
        FROM last_sent s
        JOIN first_click_after f
          ON f.client_id = s.client_id
      )
      SELECT
        COUNT(*)::numeric AS pair_count,
        AVG(diff_seconds)       AS avg_seconds
      FROM pairs;
    `, [userId]);

    const row = q.rows[0] || { pair_count: null, avg_seconds: null };
    const count = row?.pair_count ? Number(row.pair_count) : 0;
    const avgSeconds = row?.avg_seconds != null ? Number(row.avg_seconds) : null;

    return NextResponse.json({
      success: true,
      userId,
      consideredClients: count,
      avgSeconds,
      avgMinutes: avgSeconds == null ? null : avgSeconds / 60,
      avgHours:   avgSeconds == null ? null : avgSeconds / 3600,
    });
  } catch (err: any) {
    console.error("[avg-email-to-click] error:", err?.message || err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
