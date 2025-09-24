// app/api/recent-reviews/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

// NOTE: This query expects a column `updated_at` on `clients`.
// If you don't have it yet, either add it or remove the COALESCE() fallback.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { userId } = body as { userId?: string };

    if (!userId) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }

    const { rows } = await pool.query(
      `
      SELECT
        id                AS client_id,
        name              AS client_name,
        sentiment,
        review,
        COALESCE(updated_at, created_at) AS updated_at
      FROM clients
      WHERE user_id = $1
        AND review IS NOT NULL
        AND length(btrim(review)) > 0
      ORDER BY COALESCE(updated_at, created_at) DESC
      LIMIT 10
      `,
      [userId]
    );

    // Return just what you need; keeping some metadata is often helpful
    return NextResponse.json({
      success: true,
      count: rows.length,
      reviews: rows.map((r) => ({
        client_id: r.client_id,
        client_name: r.client_name,
        sentiment: r.sentiment,
        review: r.review,
        updated_at: r.updated_at,
      })),
    });
  } catch (err) {
    console.error("recent-reviews error:", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
