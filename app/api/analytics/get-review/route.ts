// app/api/analytics/get-review/route.ts
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
      // Keep SSL for Neon unless your URL already has sslmode=require
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPool;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReqBody = {
  userId?: string;
  excerpt_id?: string;
};

export async function POST(req: NextRequest) {
  try {
    const { userId, excerpt_id } = (await req.json().catch(() => ({}))) as ReqBody;

    if (!userId) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }
    if (!excerpt_id) {
      return NextResponse.json({ error: "MISSING_EXCERPT_ID" }, { status: 400 });
    }

    const pool = getPool();

    // 1) Fetch the excerpt row, user-scoped
    const exQ = await pool.query<{
      id: string;
      user_id: string;
      review_id: string | null;
      g_review_id: string | null;
    }>(
      `
      SELECT id, user_id, review_id, g_review_id
      FROM public.excerpts
      WHERE id = $1 AND user_id = $2
      LIMIT 1
      `,
      [excerpt_id, userId]
    );

    if (exQ.rowCount === 0) {
      return NextResponse.json({ error: "EXCERPT_NOT_FOUND" }, { status: 404 });
    }

    const ex = exQ.rows[0];
    const hasInternalReview = !!ex.review_id;

    if (hasInternalReview) {
      // 2a) review_id exists → pull from reviews (primary text) + client name
      const rQ = await pool.query<{
        id: string;
        review: string | null;
        google_review: string | null;
        stars: number | null;
        client_id: string | null;
        created_at: string | null;
        reviewer_name: string | null;
        primary_text: string | null;
      }>(
        `
        SELECT
          r.id,
          r.review,
          r.google_review,
          r.stars,
          r.client_id,
          r.created_at,
          c.name AS reviewer_name,
          CASE
            WHEN r."isPrimary" = 'google'::review_primary_source
              THEN NULLIF(BTRIM(r.google_review), '')
            ELSE NULLIF(BTRIM(r.review), '')
          END AS primary_text
        FROM public.reviews r
        LEFT JOIN public.clients c
          ON c.id = r.client_id
        WHERE r.id = $1
          AND r.user_id = $2
        LIMIT 1
        `,
        [ex.review_id, userId]
      );

      if (rQ.rowCount === 0) {
        return NextResponse.json({ error: "REVIEW_NOT_FOUND" }, { status: 404 });
      }

      const r = rQ.rows[0];
      const text =
        (r.primary_text && r.primary_text.trim()) ||
        (r.review && r.review.trim()) ||
        (r.google_review && r.google_review.trim()) ||
        null;

      return NextResponse.json(
        {
          success: true,
          source: "reviews",
          review: {
            id: r.id,
            text,
            stars: r.stars,
            reviewer_name: r.reviewer_name ?? null,
            created_at: r.created_at ?? null,
          },
        },
        { status: 200 }
      );
    } else {
      // 2b) No review_id → fall back to google_reviews via g_review_id
      if (!ex.g_review_id) {
        return NextResponse.json({ error: "MISSING_G_REVIEW_ID_ON_EXCERPT" }, { status: 422 });
      }

      const gQ = await pool.query<{
        id: string;
        review: string | null;
        stars: number | null;
        name: string | null;
        created_at: string | null;
      }>(
        `
        SELECT id, review, stars, name, created_at
        FROM public.google_reviews
        WHERE id = $1
          AND user_id = $2
        LIMIT 1
        `,
        [ex.g_review_id, userId]
      );

      if (gQ.rowCount === 0) {
        return NextResponse.json({ error: "GOOGLE_REVIEW_NOT_FOUND" }, { status: 404 });
      }

      const g = gQ.rows[0];

      return NextResponse.json(
        {
          success: true,
          source: "google_reviews",
          review: {
            id: g.id,
            text: g.review ?? null,
            stars: g.stars ?? null,
            reviewer_name: g.name ?? null,
            created_at: g.created_at ?? null,
          },
        },
        { status: 200 }
      );
    }
  } catch (err: any) {
    console.error("[/api/analytics/get-review] error:", err?.stack || err);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
