import { Pool } from "pg";
import { NextRequest, NextResponse } from "next/server";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true }, // keep if your Neon setup has proper certs
});

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    if (!userId) {
      return NextResponse.json({ error: "User ID required" }, { status: 400 });
    }

    const result = await pool.query<{
      good: string | number;
      bad: string | number;
      not_reviewed_yet: string | number;
    }>(
      `
      SELECT
        COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(sentiment, ''))) = 'good') AS good,
        COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(sentiment, ''))) = 'bad')  AS bad,
        COUNT(*) FILTER (WHERE review_submitted IS NOT TRUE)                   AS not_reviewed_yet
      FROM public.clients
      WHERE user_id = $1
        AND email_sent IS TRUE
      `,
      [userId]
    );

    const row = result.rows[0] ?? { good: 0, bad: 0, not_reviewed_yet: 0 };

    return NextResponse.json(
      {
        good: Number(row.good) || 0,
        bad: Number(row.bad) || 0,
        not_reviewed_yet: Number(row.not_reviewed_yet) || 0,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[POST /api/statistics] error:", err?.message || err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
