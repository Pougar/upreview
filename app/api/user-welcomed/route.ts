// app/api/user-welcomed/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth"; // BetterAuth server instance

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

export async function POST(req: NextRequest) {
  let client;
  try {
    // Try body first, then fall back to BetterAuth session
    const body = await req.json().catch(() => ({}));
    let userId: string | undefined = body?.userId;

    if (!userId) {
      const session = await auth.api.getSession({ headers: req.headers });
      userId = session?.user?.id;
    }

    if (!userId) {
      return NextResponse.json(
        { error: "MISSING_USER", message: "No userId in body or session." },
        { status: 401 }
      );
    }

    client = await pool.connect();
    await client.query("BEGIN");

    // 1) Log action
    await client.query(
      `INSERT INTO user_actions (user_id, action)
       VALUES ($1, 'welcomed')`,
      [userId]
    );

    await client.query("COMMIT");
    return NextResponse.json({ success: true });
  } catch (err) {
    try {
      if (client) await client.query("ROLLBACK");
    } catch {}
    console.error("user-welcomed error:", err);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not record welcomed state." },
      { status: 500 }
    );
  } finally {
    client?.release();
  }
}
