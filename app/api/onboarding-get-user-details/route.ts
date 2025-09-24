// app/api/onboarding-get-user-details/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

type TableLoc = { schema: string; table: string } | null;

const TABLE_ENV = process.env.BETTERAUTH_USERS_TABLE; // e.g. "public.users" or "auth.users"

const CANDIDATE_TABLES: Array<{ schema: string; table: string }> = [
  { schema: "public",      table: "user" }
];

const NAME_CANDIDATES = ["name", "full_name", "display_name", "username"];
const EMAIL_CANDIDATES = ["email", "primary_email", "email_address"];

function parseEnvTable(v?: string): TableLoc {
  if (!v) return null;
  const parts = v.split(".").map((s) => s.trim().replaceAll(`"`, ""));
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { schema: parts[0], table: parts[1] };
  }
  // If only a table given, assume public schema
  if (parts.length === 1 && parts[0]) {
    return { schema: "public", table: parts[0] };
  }
  return null;
}

async function tableExists(schema: string, table: string): Promise<boolean> {
  const q = `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = $1 AND table_name = $2
    LIMIT 1
  `;
  const { rowCount } = await pool.query(q, [schema, table]);
  return !!rowCount;
}

async function findUsersTable(): Promise<TableLoc> {
  // 1) If env var explicitly set, prefer it (and verify it exists)
  const envLoc = parseEnvTable(TABLE_ENV);
  if (envLoc && (await tableExists(envLoc.schema, envLoc.table))) return envLoc;

  // 2) Try common defaults
  for (const t of CANDIDATE_TABLES) {
    if (await tableExists(t.schema, t.table)) return t;
  }
  return null;
}

async function getColumns(schema: string, table: string): Promise<Set<string>> {
  const q = `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
  `;
  const { rows } = await pool.query<{ column_name: string }>(q, [schema, table]);
  return new Set(rows.map((r) => r.column_name));
}

function pickFirstAvailable(candidates: string[], available: Set<string>): string | null {
  for (const c of candidates) {
    if (available.has(c)) return c;
  }
  return null;
}

function ident(schemaOrTableOrCol: string): string {
  // Double-quote identifiers to avoid case/keyword issues
  return `"${schemaOrTableOrCol.replaceAll(`"`, `""`)}"`;
}

export async function POST(req: NextRequest) {
  try {
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
    }

    const userId = (body?.userId ?? "").toString().trim();
    if (!userId) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }

    const loc = await findUsersTable();
    if (!loc) {
      return NextResponse.json(
        { error: "USERS_TABLE_NOT_FOUND" },
        { status: 500 }
      );
    }

    const cols = await getColumns(loc.schema, loc.table);

    // Find best-available name/email column choices
    const nameCol = pickFirstAvailable(NAME_CANDIDATES, cols);
    const emailCol = pickFirstAvailable(EMAIL_CANDIDATES, cols);

    // Build a safe SELECT with fallbacks. If a column doesn't exist, select NULL::text for it.
    const nameExpr = nameCol ? `${ident(nameCol)}` : `NULL::text`;
    const emailExpr = emailCol ? `${ident(emailCol)}` : `NULL::text`;

    const sql = `
      SELECT
        ${nameExpr} AS name,
        ${emailExpr} AS email
      FROM ${ident(loc.schema)}.${ident(loc.table)}
      WHERE ${ident("id")} = $1
      LIMIT 1
    `;

    const { rows } = await pool.query<{ name: string | null; email: string | null }>(sql, [userId]);

    if (!rows.length) {
      return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
    }

    const result = rows[0] || { name: null, email: null };
    return NextResponse.json(
      {
        name: result.name ?? null,
        email: result.email ?? null,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("onboarding-get-user-details error:", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
