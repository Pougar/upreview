// app/api/actions/google-connected/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

// Adjust if your enum/schema/table/columns differ
const ACTION_VALUE = "google_connected";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { userId } = body as { userId?: string };

    if (!userId || typeof userId !== "string" || !userId.trim()) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }

    // Idempotent insert: only add if not already present
    const { rowCount } = await pool.query(
      `
      INSERT INTO user_actions (user_id, action)
      SELECT $1, $2
      WHERE NOT EXISTS (
        SELECT 1 FROM user_actions WHERE user_id = $1 AND action = $2
      )
      `,
      [userId, ACTION_VALUE]
    );

    // created_at is assumed to default to NOW() in your schema. If not, add it explicitly.
    return NextResponse.json({
      success: true,
      created: rowCount === 1,      // true if a new row was inserted
      already_present: rowCount === 0,
      action: ACTION_VALUE,
      userId,
    });
  } catch (err) {
    console.error("google-connected action error:", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
