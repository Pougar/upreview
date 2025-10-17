// app/api/add-user-action/xero-connected/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

const ACTION_VALUE = "xero_connected";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { userId } = body as { userId?: string };

    if (!userId || typeof userId !== "string" || !userId.trim()) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }

    // Insert only if not already present (idempotent)
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

    return NextResponse.json({
      success: true,
      created: rowCount === 1,
      already_present: rowCount === 0,
      action: ACTION_VALUE,
      userId,
    });
  } catch (err) {
    console.error("xero-connected action error:", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
