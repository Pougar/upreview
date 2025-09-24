// app/api/clients/route.ts
import { NextResponse } from "next/server";
import { headers as nextHeaders } from "next/headers";
import { auth } from "@/app/lib/auth";
import { Pool } from "pg";

/** ---------- PG Pool (singleton across hot reloads) ---------- */
declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

function getPool(): Pool {
  if (!global._pgPool) {
    const cs = process.env.DATABASE_URL;
    if (!cs) {
      throw new Error("DATABASE_URL is not set");
    }
    global._pgPool = new Pool({
      connectionString: cs,
      // Neon usually requires SSL; keep this if your URL doesn't already have sslmode=require
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPool;
}

/** Convert Next 15 ReadonlyHeaders -> standard Fetch Headers for Better Auth */
async function getNodeHeaders(): Promise<Headers> {
  const h = await Promise.resolve(nextHeaders() as any);
  return new Headers(Object.fromEntries(h.entries()));
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/**
 * GET /api/clients
 * Returns clients belonging to the currently-authenticated user.
 * Response shape: { clients: Array<{ id, name, email, phone_number, sentiment, review, email_sent, review_clicked, review_submitted }> }
 */
export async function GET() {
  try {
    // 1) Validate session
    const requestHeaders = await getNodeHeaders();
    const session = await auth.api.getSession({ headers: requestHeaders });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Your `clients.user_id` references public.myusers.betterauth_id (TEXT)
    const userId = String(session.user.id);

    // 2) Query Neon
    const pool = getPool();
    const { rows } = await pool.query(
      `
      SELECT
        id,
        name,
        email,
        phone_number,
        sentiment,
        review,
        email_sent,
        review_clicked,
        review_submitted
      FROM public.clients
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      `,
      [userId],
    );

    // 3) Return
    return NextResponse.json({ clients: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/clients] Error:", err?.message || err);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}
