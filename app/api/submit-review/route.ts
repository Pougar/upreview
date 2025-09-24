// app/api/submit-review/route.ts
import { NextResponse } from "next/server";
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
      // Keep SSL for Neon unless your URL already has sslmode=require
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPool;
}

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const clientId = body?.clientId as string | undefined;
    const reviewType = body?.reviewType as "good" | "bad" | undefined;
    const reviewRaw = (body?.review ?? "") as string;

    if (!clientId) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }
    if (reviewType !== "good" && reviewType !== "bad") {
      return NextResponse.json({ error: "reviewType must be 'good' or 'bad'" }, { status: 400 });
    }
    if (typeof reviewRaw !== "string" || reviewRaw.trim().length === 0) {
      return NextResponse.json({ error: "review text is required" }, { status: 400 });
    }

    const review = reviewRaw.trim();
    const pool = getPool();

    // 1) Check current state
    const sel = await pool.query<{ review_submitted: boolean | null }>(
      `SELECT review_submitted FROM public.clients WHERE id = $1`,
      [clientId]
    );
    if ((sel.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (sel.rows[0].review_submitted) {
      return NextResponse.json(
        { error: "REVIEW_ALREADY_SUBMITTED" },
        { status: 409 }
      );
    }

    // 2) Atomically: update fields + log client action
    const db = await pool.connect();
    try {
      await db.query("BEGIN");

      const upd = await db.query(
        `
        UPDATE public.clients
           SET review = $1,
               sentiment = $2,
               review_submitted = TRUE
         WHERE id = $3
           AND (review_submitted IS DISTINCT FROM TRUE)
        `,
        [review, reviewType, clientId]
      );

      if ((upd.rowCount ?? 0) > 0) {
        // Only log if we actually flipped review_submitted to TRUE
        await db.query(
          `INSERT INTO public.client_actions (client_id, action)
           VALUES ($1, 'review_submitted')`,
          [clientId]
        );
      }

      await db.query("COMMIT");
      return NextResponse.json({ ok: true }, { status: 200 });
    } catch (e) {
      try { await db.query("ROLLBACK"); } catch {}
      throw e;
    } finally {
      db.release();
    }
  } catch (err: any) {
    console.error("[POST /api/submit-review] error:", err?.message || err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
