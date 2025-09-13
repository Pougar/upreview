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
    // Parse the JSON body
    const body = await req.json();
    const { id } = body;
    if (!id ) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const result = await pool.query(
    `SELECT name FROM myusers WHERE betterauth_id = $1`,
    [id]
    );

    const name = result.rows[0]?.name;

    if (result.rows.length === 0) {
      // Conflict occurred, user already exists
      return NextResponse.json({ error: "User already exists" }, { status: 409 });
    }
    return NextResponse.json({ success: true , name: name });
  } catch (err) {
    console.error("Error creating user:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}