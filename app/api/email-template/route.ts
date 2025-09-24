// app/api/user/email-template/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

// GET current subject/body for the logged-in user
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

    const { rows } = await pool.query<{ email_subject: string | null; email_body: string | null }>(
      `SELECT email_subject, email_body
         FROM myusers
        WHERE betterauth_id = $1
        LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
    }

    const { email_subject, email_body } = rows[0];
    return NextResponse.json({ success: true, email_subject, email_body });
  } catch (e) {
    console.error("GET /api/user/email-template error", e);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}

// POST new subject/body for the logged-in user
export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

    const { email_subject, email_body } = (await req.json()) as {
      email_subject?: string;
      email_body?: string;
    };

    // Basic validation / trimming (adjust limits to taste)
    const subject = (email_subject ?? "").toString().trim().slice(0, 200);
    const body = (email_body ?? "").toString().trim().slice(0, 8000);

    const { rows } = await pool.query<{ email_subject: string; email_body: string }>(
      `UPDATE myusers
          SET email_subject = $1,
              email_body = $2
        WHERE betterauth_id = $3
        RETURNING email_subject, email_body`,
      [subject, body, userId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json({ success: true, ...rows[0] });
  } catch (e) {
    console.error("POST /api/user/email-template error", e);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
