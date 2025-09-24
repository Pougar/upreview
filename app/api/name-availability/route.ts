import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const name = (searchParams.get("name") || "").trim();
    const email = (searchParams.get("email") || "").trim();

    if (!name) {
      return NextResponse.json({ error: "MISSING_NAME" }, { status: 400 });
    }

    let base = slugify(name);
    if (!base) {
      const local = email.split("@")[0] ?? "";
      base = slugify(local) || "user";
    }

    const { rows } = await pool.query<{ taken: boolean }>(
      `SELECT (
         EXISTS (SELECT 1 FROM reserved_slugs WHERE slug = $1) OR
         EXISTS (SELECT 1 FROM myusers       WHERE name = $1)
       ) AS taken`,
      [base]
    );

    if (rows[0]?.taken === true) {
      return NextResponse.json(
        { available: false, slug: base, error: "NAME_TAKEN", message: "That name is already taken." },
        { status: 409 }
      );
    }

    return NextResponse.json({ available: true, slug: base });
  } catch (e) {
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
