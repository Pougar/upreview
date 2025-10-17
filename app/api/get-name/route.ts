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
    const body = await req.json().catch(() => ({}));
    const { id } = body as { id?: string };

    if (!id || typeof id !== "string" || !id.trim()) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }

    // 1) Try myusers by betterauth_id
    const myUsersRes = await pool.query<{ name: string | null; display_name: string | null }>(
      `
      SELECT name, display_name
        FROM myusers
       WHERE betterauth_id = $1
       LIMIT 1
      `,
      [id]
    );

    if (myUsersRes.rowCount && myUsersRes.rows[0]) {
      const { name, display_name } = myUsersRes.rows[0];
      return NextResponse.json({
        success: true,
        user: { name: name ?? "", display_name: display_name ?? "" },
        missingMyuser: false,
        source: "myusers",
      });
    }

    // 2) Not in myusers — fall back to users table by id
    const usersRes = await pool.query<{ id: string }>(
      `
      SELECT id
        FROM users
       WHERE id = $1
       LIMIT 1
      `,
      [id]
    );

    if (usersRes.rowCount && usersRes.rows[0]) {
      // Found the user account, but no myusers profile yet
      return NextResponse.json({
        success: true,
        user: { id: usersRes.rows[0].id },
        missingMyuser: true,
        source: "users",
      });
    }

    // 3) Not found anywhere
    return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
  } catch (err) {
    console.error("Error fetching user:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
