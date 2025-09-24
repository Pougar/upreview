import { Pool } from "pg";
import { NextRequest, NextResponse } from "next/server";

console.log("Module loaded");

// Connect to your Neon DB
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true }, // equivalent to 'verify-full'
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id } = body as { id?: string };

    if (!id) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }

    const { rows } = await pool.query<{ name: string; display_name: string }>(
      `SELECT name, display_name
         FROM myusers
        WHERE betterauth_id = $1
        LIMIT 1`,
      [id]
    );

    if (rows.length === 0) {
      // No user with this betterauth_id
      return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
    }

    const { name, display_name } = rows[0];
    return NextResponse.json({ success: true, user: { name, display_name } });
  } catch (err) {
    console.error("Error fetching user:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
