import { Pool } from "pg";
import { NextRequest, NextResponse } from "next/server";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true }, // equivalent to 'verify-full'
});

export async function POST(req: NextRequest) {
    const { userId } = await req.json();
    if (!userId) {
        return NextResponse.json({ error: "User ID required" }, { status: 400 });
    }
    const result = await pool.query(
        `SELECT happy_clients AS good,
                sad_clients AS bad,
                unresponsive_clients AS not_reviewed_yet
        FROM myusers
        WHERE betterauth_id = $1`,
        [userId]
    );

  if (result.rowCount === 0) {
    return NextResponse.json({ good: 0, bad: 0, not_reviewed_yet: 0 });
  }

  return NextResponse.json(result.rows[0]);
}
