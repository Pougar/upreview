import { Pool } from "pg";
import { NextRequest, NextResponse } from "next/server";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId } = body as { userId?: string };

    if (!userId) {
      return NextResponse.json(
        { error: "MISSING_FIELDS", message: "userId is required" },
        { status: 400 }
      );
    }

    // Check if the user has a finished_onboarding action
    const { rows } = await pool.query<{ onboarded: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM user_actions
        WHERE user_id = $1
          AND action = 'finished_onboarding'
      ) AS onboarded
      `,
      [userId]
    );

    const onboarded = rows[0]?.onboarded === true;
    return NextResponse.json({ onboarded });
  } catch (err) {
    console.error("Error checking onboarded status:", err);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not check onboarded status" },
      { status: 500 }
    );
  }
}
