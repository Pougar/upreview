// app/api/review-clicked-update/route.ts
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
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPool;
}

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { clientId } = await req.json().catch(() => ({}));
    if (!clientId || typeof clientId !== "string") {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }

    const pool = getPool();

    // 1) Check current values
    const sel = await pool.query<{
      review_clicked: boolean | null;
      review_submitted: boolean | null;
      email_sent: boolean | null;
    }>(
      `SELECT review_clicked, review_submitted, email_sent
       FROM public.clients
       WHERE id = $1`,
      [clientId]
    );

    if (sel.rowCount === 0) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const { review_clicked, review_submitted, email_sent } = sel.rows[0];

    // Reject if email not sent or review already submitted
    if (!email_sent) {
      return NextResponse.json({ error: "EMAIL_NOT_SENT" }, { status: 403 });
    }
    if (review_submitted) {
      return NextResponse.json({ error: "REVIEW_ALREADY_SUBMITTED" }, { status: 403 });
    }

    // If already clicked, just acknowledge
    if (review_clicked) {
      return NextResponse.json({ ok: true, already: true }, { status: 200 });
    }

    // 2) Flip to true and log the action atomically
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Update guard (still ensure not flipped concurrently)
      const upd = await client.query(
        `UPDATE public.clients
           SET review_clicked = TRUE
         WHERE id = $1
           AND review_clicked IS DISTINCT FROM TRUE
           AND email_sent IS TRUE
           AND (review_submitted IS NOT TRUE)
        `,
        [clientId]
      );

      if (upd.rowCount === 0) {
        // Nothing to update — either already true or violated guards in the tiny window.
        await client.query("ROLLBACK");
        return NextResponse.json({ ok: true, already: true }, { status: 200 });
      }

      // Log the link click
      await client.query(
        `INSERT INTO public.client_actions (client_id, action)
         VALUES ($1, 'link_clicked')`,
        [clientId]
      );

      await client.query("COMMIT");
      return NextResponse.json({ ok: true, updated: true }, { status: 200 });
    } catch (e) {
      try { await pool.query("ROLLBACK"); } catch {}
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("[POST /api/review-clicked-update] error:", err?.message || err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
