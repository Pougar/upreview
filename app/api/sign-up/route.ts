import postgres from "postgres";
import { NextRequest, NextResponse } from "next/server";

// Connect to your Neon DB
const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' }); // make sure DATABASE_URL is in .env

export async function POST(req: NextRequest) {
  try {
    // Parse the JSON body
    const body = await req.json();
    const { id, name, email } = body;

    if (!id || !name || !email) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Insert into your database (no passwords)
    await sql`INSERT INTO users (betterauth_id, name, email) VALUES (${id}, ${name}, ${email})`;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Error creating user:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}