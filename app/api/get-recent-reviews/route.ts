// app/api/get-recent-reviews/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { userId, limit } = body as { userId?: string; limit?: number };

    if (!userId) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }

    const rowLimit =
      Number.isFinite(limit) && (limit as number) > 0 ? Math.min(Number(limit), 50) : 10;

    const { rows } = await pool.query(
      `
      WITH internal_reviews AS (
        SELECT
          r.id::text                AS review_id,
          r.client_id::text         AS client_id,
          'internal'::text          AS is_primary,
          c.name::text              AS client_name,
          r.happy::boolean          AS sentiment,          -- from reviews.happy
          r.stars::int              AS stars,
          CASE
            WHEN r."isPrimary" = 'google'::review_primary_source
              THEN NULLIF(BTRIM(r.google_review), '')
            ELSE NULLIF(BTRIM(r.review), '')
          END::text                 AS review_text,
          r.created_at,
          r.updated_at
        FROM public.reviews r
        LEFT JOIN public.clients c ON c.id = r.client_id
        WHERE r.user_id = $1
          AND (
            CASE
              WHEN r."isPrimary" = 'google'::review_primary_source
                THEN NULLIF(BTRIM(r.google_review), '')
              ELSE NULLIF(BTRIM(r.review), '')
            END
          ) IS NOT NULL
      ),
      google_unlinked AS (
        SELECT
          google_reviews.id::text   AS review_id,
          NULL::text                AS client_id,
          'google'::text            AS is_primary,
          google_reviews.name::text AS client_name,
          /* infer sentiment from stars; 2.5–3.5 => NULL (no badge) */
          CASE
            WHEN google_reviews.stars IS NULL THEN NULL
            WHEN (google_reviews.stars::numeric) >= 4 THEN TRUE
            WHEN (google_reviews.stars::numeric) <= 2 THEN FALSE
            WHEN (google_reviews.stars::numeric) BETWEEN 2.5 AND 3.5 THEN NULL
            ELSE NULL
          END                       AS sentiment,
          google_reviews.stars::int AS stars,
          NULLIF(BTRIM(google_reviews.review), '')::text AS review_text,
          google_reviews.created_at,
          google_reviews.updated_at
        FROM public.google_reviews
        WHERE google_reviews.user_id = $1
          AND COALESCE(google_reviews.linked, false) = false
          AND NULLIF(BTRIM(google_reviews.review), '') IS NOT NULL
      )
      SELECT *
      FROM (
        SELECT * FROM internal_reviews
        UNION ALL
        SELECT * FROM google_unlinked
      ) u
      ORDER BY COALESCE(u.updated_at, u.created_at) DESC NULLS LAST
      LIMIT $2
      `,
      [userId, rowLimit]
    );

    return NextResponse.json({
      success: true,
      count: rows.length,
      reviews: rows.map((r) => ({
        review_id: r.review_id,
        client_id: r.client_id,                        // null for google rows
        is_primary: r.is_primary as "google" | "internal",
        client_name: r.client_name ?? null,
        sentiment: r.sentiment as boolean | null,      // NULL for 2.5–3.5 stars
        stars: r.stars ?? null,
        review: r.review_text,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
    });
  } catch (err: any) {
    console.error("[recent-reviews] error:", err?.stack || err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
