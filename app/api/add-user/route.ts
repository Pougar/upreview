import { Pool } from "pg";
import { NextRequest, NextResponse } from "next/server";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

// slugify: lowercases, strips accents, replaces non [a-z0-9] with '-'
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

function isValidEmail(str?: string) {
  return !!str && /.+@.+\..+/.test(str);
}

function looksLikeGoogleBusinessLink(urlStr?: string) {
  if (!urlStr) return true; // optional
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
    const body = await req.json();

    // Preferred inputs from onboarding:
    const {
      id,
      email,
      businessName,
      businessEmail,
      googleBusinessLink,
      name: legacyName, // fallback
    }: {
      id?: string;
      email?: string;
      businessName?: string;
      businessEmail?: string;
      googleBusinessLink?: string;
      name?: string;
    } = body || {};

    const nameInput = businessName ?? legacyName;

    if (!id || !nameInput || !email) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
    }
    if (businessEmail && !isValidEmail(businessEmail)) {
      return NextResponse.json({ error: "INVALID_BUSINESS_EMAIL" }, { status: 400 });
    }
    if (!looksLikeGoogleBusinessLink(googleBusinessLink)) {
      return NextResponse.json({ error: "INVALID_GOOGLE_LINK" }, { status: 400 });
    }

    const displayName = String(nameInput).trim();
    let base = slugify(displayName);
    if (!base) {
      const local = String(email).split("@")[0] ?? "";
      base = slugify(local) || `user-${String(id).slice(0, 8)}`;
    }

    // Null-safe boolean check: is this slug reserved or already used?
    const { rows } = await pool.query<{ taken: boolean }>(
      `SELECT (
         EXISTS (SELECT 1 FROM reserved_slugs WHERE slug = $1) OR
         EXISTS (SELECT 1 FROM myusers       WHERE name = $1)
       ) AS taken`,
      [base]
    );
    const isTaken = rows[0]?.taken === true;
    if (isTaken) {
      return NextResponse.json(
        { error: "NAME_TAKEN", message: "That name is already taken." },
        { status: 409 }
      );
    }

    // Insert; if a race happens, catch unique-violation and return NAME_TAKEN / USER_EXISTS
    try {
      const result = await pool.query(
        `
        INSERT INTO myusers (
          betterauth_id,
          name,
          display_name,
          email,
          business_email,
          google_business_link
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (betterauth_id) DO NOTHING
        RETURNING betterauth_id, name, display_name, email, business_email, google_business_link
        `,
        [id, base, displayName, email, businessEmail ?? null, googleBusinessLink ?? null]
      );

      if (result.rows.length === 0) {
        return NextResponse.json({ error: "USER_EXISTS" }, { status: 409 });
      }

      const createdUser = result.rows[0];

      // 🔹 Log finished_onboarding action (best-effort; don't block success)
      try {
        await pool.query(
          `INSERT INTO user_actions (user_id, action)
           VALUES ($1, 'finished_onboarding')`,
          [createdUser.betterauth_id]
        );
      } catch (logErr) {
        console.error("Failed to record finished_onboarding:", logErr);
        // continue without failing the response
      }

      return NextResponse.json({ success: true, user: createdUser });
    } catch (e: any) {
      if (e?.code === "23505") {
        // Likely unique index on myusers.name or betterauth_id
        const msg = String(e?.detail || "");
        if (msg.includes("(name)")) {
          return NextResponse.json(
            { error: "NAME_TAKEN", message: "That name is already taken." },
            { status: 409 }
          );
        }
        if (msg.includes("(betterauth_id)")) {
          return NextResponse.json({ error: "USER_EXISTS" }, { status: 409 });
        }
        return NextResponse.json({ error: "CONFLICT" }, { status: 409 });
      }
      throw e;
    }
  } catch (err) {
    console.error("Error creating user:", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
