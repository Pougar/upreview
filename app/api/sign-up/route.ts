import { Pool } from "pg";
import { NextRequest, NextResponse } from "next/server";

console.log("Module loaded");
// Connect to your Neon DB

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true }, // equivalent to 'verify-full'
});

console.log("Connected to db");
export async function POST(req: NextRequest) {
    console.log("POST called")
  try {
    // Parse the JSON body
    const body = await req.json();
    const { id, name, email } = body;
    console.log("Received user data:", body);
    if (!id || !name || !email) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Insert into your database (no passwords)
    const result = await pool.query(
      `INSERT INTO users (betterauth_id, name, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (betterauth_id) DO NOTHING
       RETURNING *`,
      [id, name, email]
    );

    if (result.rows.length === 0) {
      // Conflict occurred, user already exists
      return NextResponse.json({ error: "User already exists" }, { status: 409 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Error creating user:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}