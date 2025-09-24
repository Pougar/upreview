// app/api/update-slug/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

// Same slugify you use elsewhere
function slugify(input: string, maxLen = 60): string {
  const ascii = input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, maxLen)
    .replace(/^-+|-+$/g, "");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { userId, newName } = body as {
      userId?: string;
      newName?: string; // desired slug (may be raw)
      // email?: string; // optional; not required here
    };

    if (!userId || !newName) {
      return NextResponse.json(
        { error: "MISSING_FIELDS", message: "userId and newName are required." },
        { status: 400 }
      );
    }

    // Normalize/validate the slug server-side
    const cleaned = slugify(String(newName));
    if (!cleaned) {
      return NextResponse.json(
        { error: "INVALID_SLUG", message: "Please provide a valid slug (letters/numbers)." },
        { status: 400 }
      );
    }

    // Ensure the user exists and get the current slug
    const userRes = await pool.query(
      `SELECT betterauth_id, name FROM myusers WHERE betterauth_id = $1`,
      [userId]
    );
    if (userRes.rows.length === 0) {
      return NextResponse.json(
        { error: "USER_NOT_FOUND", message: "No myusers row for this userId." },
        { status: 404 }
      );
    }

    const currentSlug: string = userRes.rows[0].name;
    if (currentSlug === cleaned) {
      // No change; return current info
      const echo = await pool.query(
        `SELECT betterauth_id, name, display_name, email FROM myusers WHERE betterauth_id = $1`,
        [userId]
      );
      return NextResponse.json({ success: true, user: echo.rows[0] });
    }

    // Check reserved or taken by someone else
    const checkRes = await pool.query<{ taken: boolean }>(
      `
      SELECT (
        EXISTS (SELECT 1 FROM reserved_slugs WHERE slug = $1) OR
        EXISTS (SELECT 1 FROM myusers WHERE name = $1 AND betterauth_id <> $2)
      ) AS taken
      `,
      [cleaned, userId]
    );
    if (checkRes.rows[0]?.taken === true) {
      return NextResponse.json(
        { error: "NAME_TAKEN", message: "That URL is already taken." },
        { status: 409 }
      );
    }

    // Update
    try {
      const upd = await pool.query(
        `
        UPDATE myusers
           SET name = $1
         WHERE betterauth_id = $2
         RETURNING betterauth_id, name, display_name, email
        `,
        [cleaned, userId]
      );

      if (upd.rows.length === 0) {
        return NextResponse.json(
          { error: "USER_NOT_FOUND", message: "No myusers row for this userId." },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true, user: upd.rows[0] });
    } catch (e: any) {
      // In case of a race, unique constraint might still fire
      if (e?.code === "23505") {
        return NextResponse.json(
          { error: "NAME_TAKEN", message: "That URL is already taken." },
          { status: 409 }
        );
      }
      throw e;
    }
  } catch (err) {
    console.error("update-slug error:", err);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not update slug." },
      { status: 500 }
    );
  }
}
