// app/api/settings/user-settings/get-business-info/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

export async function POST(req: NextRequest) {
  try {
    const { userId } = (await req.json()) as { userId?: string };

    if (!userId) {
      return NextResponse.json(
        { error: "MISSING_FIELDS", message: "userId is required" },
        { status: 400 }
      );
    }

    const { rows } = await pool.query<{
      description: string | null;
      google_business_link: string | null;
    }>(
      `SELECT description, google_business_link
         FROM myusers
        WHERE betterauth_id = $1
        LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "User not found" },
        { status: 404 }
      );
    }

    const row = rows[0];
    return NextResponse.json({
      description: row.description ?? null,
      googleBusinessLink: row.google_business_link ?? null, // camelCase for FE
    });
  } catch (err) {
    console.error("get-business-info failed:", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
