// app/api/retrieve-logo-url/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { supabaseAdmin } from "@/app/lib/supabaseServer"; // server-only client

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

// Choose how long the signed URL should last (in seconds)
const EXPIRES_IN_SECONDS = 60 * 10; // 10 minutes

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    if (!userId) {
      return NextResponse.json({ error: "MISSING_USER" }, { status: 400 });
    }

    const { rows } = await pool.query(
      `SELECT company_logo_path FROM myusers WHERE betterauth_id = $1`,
      [userId]
    );

    const path: string | null = rows[0]?.company_logo_path ?? null;
    if (!path) {
      return NextResponse.json({ url: null, expiresIn: 0, expiresAt: null });
    }

    const { data, error } = await supabaseAdmin.storage
      .from("company-logos")
      .createSignedUrl(path, EXPIRES_IN_SECONDS);

    if (error || !data?.signedUrl) {
      return NextResponse.json({ url: null, expiresIn: 0, expiresAt: null });
    }

    return NextResponse.json({
      url: data.signedUrl,
      expiresIn: EXPIRES_IN_SECONDS,
      expiresAt: Date.now() + EXPIRES_IN_SECONDS * 1000,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ url: null, expiresIn: 0, expiresAt: null }, { status: 500 });
  }
}
