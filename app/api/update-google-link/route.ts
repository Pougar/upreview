// app/api/update-google-link/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

// Accepts typical Google Business/Maps hostnames.
// Returns true for empty/undefined (so callers can clear the link).
function looksLikeGoogleBusinessLink(urlStr?: string | null) {
  if (!urlStr) return true;
  try {
    const u = new URL(urlStr);
    return [
      "google.com",
      "business.google.com",
      "g.page",
      "maps.app.goo.gl",
      "maps.google.com",
    ].some((d) => u.hostname.includes(d));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { userId, googleBusinessLink } = body as {
      userId?: string;
      googleBusinessLink?: string | null;
    };

    if (!userId) {
      return NextResponse.json(
        { error: "MISSING_FIELDS", message: "userId is required" },
        { status: 400 }
      );
    }

    // Normalize: empty string -> null
    const link =
      typeof googleBusinessLink === "string"
        ? googleBusinessLink.trim() || null
        : googleBusinessLink ?? null;

    if (!looksLikeGoogleBusinessLink(link)) {
      return NextResponse.json(
        { error: "INVALID_GOOGLE_LINK", message: "Provide a valid Google Business/Maps URL." },
        { status: 400 }
      );
    }

    const { rows } = await pool.query(
      `
      UPDATE myusers
         SET google_business_link = $1
       WHERE betterauth_id = $2
       RETURNING betterauth_id, google_business_link
      `,
      [link, userId]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "USER_NOT_FOUND", message: "No myusers row for this userId." },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, user: rows[0] });
  } catch (err) {
    console.error("update-google-link error:", err);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not update Google link." },
      { status: 500 }
    );
  }
}
