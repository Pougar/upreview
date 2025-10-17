// app/api/reviews/submit-review/route.ts
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

type ReviewType = "good" | "bad";

function cleanText(v: unknown): string {
  return String(v ?? "").trim();
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const clientId = body?.clientId as string | undefined;
    const userId = body?.userId as string | undefined;      // <-- provided by caller
    const reviewType = body?.reviewType as ReviewType | undefined;
    const reviewRaw = (body?.review ?? "") as string;

    if (!clientId) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }
    if (reviewType !== "good" && reviewType !== "bad") {
      return NextResponse.json({ error: "reviewType must be 'good' or 'bad'" }, { status: 400 });
    }
    const review = cleanText(reviewRaw);
    if (review.length === 0) {
      return NextResponse.json({ error: "review text is required" }, { status: 400 });
    }

    const pool = getPool();

    // 1) Ensure this client belongs to the provided user & check submitted flag
    const clientSel = await pool.query<{
      review_submitted: boolean | null;
    }>(
      `SELECT review_submitted
         FROM public.clients
        WHERE id = $1 AND user_id = $2`,
      [clientId, userId]
    );

    if ((clientSel.rowCount ?? 0) === 0) {
      // client does not exist for this user
      return NextResponse.json({ error: "Client not found for user" }, { status: 404 });
    }
    if (clientSel.rows[0].review_submitted) {
      return NextResponse.json({ error: "REVIEW_ALREADY_SUBMITTED" }, { status: 409 });
    }

    const happy = reviewType === "good"; // for reviews.happy
    const clientSentiment = reviewType;  // 'good' | 'bad'

    // 2) Transaction: upsert review for (clientId, userId) + flip flags + log
    const db = await pool.connect();
    try {
      await db.query("BEGIN");

      // Find latest review row for this client/user (may have come from Google sync)
      const existing = await db.query<{
        id: string;
        review: string | null;
        google_review: string | null;
        is_primary: "google" | "internal";
      }>(
        `
        SELECT
          r.id,
          NULLIF(BTRIM(r.review), '')         AS review,
          NULLIF(BTRIM(r.google_review), '')  AS google_review,
          r."isPrimary"                       AS is_primary
        FROM public.reviews r
        WHERE r.client_id = $1
          AND r.user_id   = $2
        ORDER BY COALESCE(r.updated_at, r.created_at) DESC NULLS LAST, r.id DESC
        LIMIT 1
        `,
        [clientId, userId]
      );

      if (existing.rowCount && existing.rows.length > 0) {
        // Update existing row: set internal review, happy, and make internal primary
        await db.query(
          `
          UPDATE public.reviews
             SET review      = $1,
                 happy       = $2,
                 "isPrimary" = 'internal'::review_primary_source
           WHERE id = $3
          `,
          [review, happy, existing.rows[0].id]
        );
      } else {
        // Insert a fresh review row as internal primary
        await db.query(
          `
          INSERT INTO public.reviews
            (client_id, user_id, review, "isPrimary", happy)
          VALUES
            ($1,        $2,      $3,     'internal'::review_primary_source, $4)
          `,
          [clientId, userId, review, happy]
        );
      }

      // Flip client flags/metadata (user-scoped in WHERE for safety)
      await db.query(
        `
        UPDATE public.clients
           SET sentiment        = $1,           -- 'good' | 'bad'
               review_submitted = TRUE,
               updated_at       = NOW()
         WHERE id = $2
           AND user_id = $3
           AND (review_submitted IS DISTINCT FROM TRUE)
        `,
        [clientSentiment, clientId, userId]
      );

      // Log action
      await db.query(
        `INSERT INTO public.client_actions (client_id, action)
         VALUES ($1, 'review_submitted')`,
        [clientId]
      );

      await db.query("COMMIT");
      return NextResponse.json({ ok: true }, { status: 200 });
    } catch (e) {
      try { await db.query("ROLLBACK"); } catch {}
      throw e;
    } finally {
      db.release();
    }
  } catch (err: any) {
    console.error("[POST /api/reviews/submit-review] error:", err?.message || err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
