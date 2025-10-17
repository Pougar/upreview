// app/api/google/has-connection/route.ts
import { NextResponse } from "next/server";
import { Pool } from "pg";

const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";

// Table & columns (note camelCase column must be quoted in SQL)
const TABLE = `public.account`;
const COL_USER_ID = `"userId"`;          // user id (text)
const COL_PROVIDER = `"providerId"`; // e.g. 'google'
const COL_SCOPE = `"scope"`;         // text: space/comma-separated scopes

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // ssl: { rejectUnauthorized: false }, // uncomment if your DB needs SSL
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const betterauth_id = url.searchParams.get("betterauth_id") || "";

    if (!betterauth_id) {
      return NextResponse.json(
        { connected: false, scopeOk: false, message: "Missing betterauth_id." },
        { status: 200 }
      );
    }

    const q = `
      SELECT ${COL_SCOPE} AS scope
      FROM ${TABLE}
      WHERE ${COL_USER_ID} = $1
        AND ${COL_PROVIDER} = 'google'
      LIMIT 1;
    `;

    const { rows } = await pool.query<{ scope: string | null }>(q, [betterauth_id]);

    if (rows.length === 0) {
      return NextResponse.json({ connected: false, scopeOk: false }, { status: 200 });
    }

    const scopeStr = rows[0].scope || "";
    const scopes = scopeStr.split(/[,\s]+/).filter(Boolean);
    const scopeOk = scopes.includes(GBP_SCOPE);

    return NextResponse.json({ connected: true, scopeOk }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      {
        connected: false,
        scopeOk: false,
        error: "HAS_CONNECTION_FAILED",
        message: err?.message || "Unexpected error checking Google connection.",
      },
      { status: 200 }
    );
  }
}
