import postgres from "postgres";
import { NextRequest, NextResponse } from "next/server";

console.log("Module loaded");
// Connect to your Neon DB
const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' }); // make sure DATABASE_URL is in .env

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
    const result = await sql`
      INSERT INTO users (betterauth_id, name, email)
      VALUES (${id}, ${name}, ${email})
      ON CONFLICT (betterauth_id) DO NOTHING
      RETURNING *
    `;

    if (result.length === 0) {
      // Conflict occurred, user already exists
      return NextResponse.json({ error: "User already exists" }, { status: 409 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Error creating user:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}