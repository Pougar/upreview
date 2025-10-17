// app/api/analytics/email-analytics/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true }, // keep if your Neon setup has proper certs
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CountsRow = {
  total_clients: number;
  email_sent: number;
  review_clicked: number;
  review_submitted: number;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { userId } = body as { userId?: string };

    if (!userId || typeof userId !== "string" || !userId.trim()) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }

    const { rows } = await pool.query<CountsRow>(
      `
      SELECT
        COUNT(*)::int                                                      AS total_clients,
        COUNT(*) FILTER (WHERE COALESCE(email_sent, false))::int           AS email_sent,
        COUNT(*) FILTER (WHERE COALESCE(review_clicked, false))::int       AS review_clicked,
        COUNT(*) FILTER (WHERE COALESCE(review_submitted, false))::int     AS review_submitted
      FROM clients
      WHERE user_id = $1
      `,
      [userId]
    );

    const r = rows[0] || {
      total_clients: 0,
      email_sent: 0,
      review_clicked: 0,
      review_submitted: 0,
    };

    // CamelCase keys for easy client-side usage
    return NextResponse.json({
      success: true,
      userId,
      totalClients: r.total_clients,
      metrics: {
        emailSent: r.email_sent,
        reviewClicked: r.review_clicked,
        reviewSubmitted: r.review_submitted,
      },
    });
  } catch (err) {
    console.error("[/api/analytics/email-analytics] error:", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
