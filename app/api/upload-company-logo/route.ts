// app/api/upload-company-logo/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseServer";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const userId = form.get("userId") as string | null;

    if (!file || !userId) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const path = `${userId}/logo.${ext}`;

    const { error: uploadErr } = await supabaseAdmin.storage
      .from("company-logos")
      .upload(path, file, {
        cacheControl: "3600",
        upsert: true,
        contentType: file.type || "image/png",
      });
    if (uploadErr) {
      console.error(uploadErr);
      return NextResponse.json({ error: "UPLOAD_FAILED" }, { status: 500 });
    }

    // Persist ONLY the path
    const { rowCount } = await pool.query(
      `UPDATE myusers
         SET company_logo_path = $1
       WHERE betterauth_id = $2`,
      [path, userId]
    );
    if (!rowCount) {
      return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
    }

    // Mint a short-lived signed URL for immediate preview (not stored)
    const { data: signed, error: signedErr } = await supabaseAdmin.storage
      .from("company-logos")
      .createSignedUrl(path, 60 * 60); // 1 hour
    if (signedErr) console.warn("Signed URL error:", signedErr);

    return NextResponse.json({
      success: true,
      path,                    // stable pointer you store in DB
      signedUrl: signed?.signedUrl ?? null, // ephemeral preview
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
