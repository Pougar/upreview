// app/api/update-business-description/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

// Optional: cap description size server-side (avoid accidental megabyte posts)
const MAX_LEN = 4000;

export async function POST(req: NextRequest) {
  try {
    const { userId, description } = (await req.json()) as {
      userId?: string;
      description?: string | null;
    };

    if (!userId) {
      return NextResponse.json(
        { error: "MISSING_FIELDS", message: "userId is required" },
        { status: 400 }
      );
    }

    // Normalize: empty/whitespace -> null, trim + cap length
    let value: string | null = null;
    if (typeof description === "string") {
      const trimmed = description.trim().slice(0, MAX_LEN);
      value = trimmed.length > 0 ? trimmed : null;
    }

    const result = await pool.query(
      `
        UPDATE myusers
           SET description = $1
         WHERE betterauth_id = $2
         RETURNING betterauth_id, name, display_name, email, business_email, google_business_link, description
      `,
      [value, userId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "User not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error("update-business-description failed:", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
