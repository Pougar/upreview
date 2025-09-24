// app/api/xero/receive-xero-connection/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import type { QueryResult } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
const NONCE_COOKIE = "xero_oauth_nonce";

// Reuse a single pool (avoids piling up connections during dev hot-reload)
const pool =
  (globalThis as any).__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined,
  });
(globalThis as any).__pgPool = pool;

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
function fromB64Url<T = any>(val: string): T {
  return JSON.parse(Buffer.from(val, "base64url").toString("utf8")) as T;
}

type XeroTokenResponse = {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  token_type: string; // "Bearer"
  expires_in: number; // seconds
  scope: string;
};
type XeroConnection = {
  id: string;         // connectionId (GUID)
  tenantId: string;   // tenant (org) GUID
  tenantType: string; // "ORGANISATION"
  tenantName: string;
};

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const origin = url.origin;

    // Error from Xero?
    const errParam = url.searchParams.get("error");
    if (errParam) {
      const desc = url.searchParams.get("error_description") || "Authorization failed.";
      return NextResponse.json({ error: errParam, description: desc }, { status: 400 });
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      return NextResponse.json({ error: "Missing code/state" }, { status: 400 });
    }

    // Validate state & nonce cookie
    const cookieNonce = req.cookies.get(NONCE_COOKIE)?.value;
    if (!cookieNonce) {
      return NextResponse.json({ error: "Missing or expired auth session" }, { status: 400 });
    }

    let decoded: { betterauthId: string; nonce: string; returnTo?: string };
    try {
      decoded = fromB64Url(state);
    } catch {
      return NextResponse.json({ error: "Invalid state" }, { status: 400 });
    }
    if (!decoded?.betterauthId || decoded.nonce !== cookieNonce) {
      return NextResponse.json({ error: "State mismatch" }, { status: 400 });
    }
    const betterauthId = decoded.betterauthId;

    const clientId = requireEnv("XERO_CLIENT_ID");
    const clientSecret = requireEnv("XERO_CLIENT_SECRET");
    const redirectUri = `${origin}/api/xero/receive-xero-connection`;

    // Exchange authorization code for tokens
    const tokenResp = await fetch(XERO_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!tokenResp.ok) {
      const body = await tokenResp.text().catch(() => "");
      return NextResponse.json(
        { error: "Token exchange failed", status: tokenResp.status, body },
        { status: 502 }
      );
    }
    const {
      access_token,
      refresh_token,
      id_token,
      token_type,
      expires_in,
      scope,
    } = (await tokenResp.json()) as XeroTokenResponse;

    // Discover granted org(s)
    const conResp = await fetch(XERO_CONNECTIONS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!conResp.ok) {
      const body = await conResp.text().catch(() => "");
      return NextResponse.json(
        { error: "Failed to retrieve Xero connections", status: conResp.status, body },
        { status: 502 }
      );
    }
    const connections = (await conResp.json()) as XeroConnection[];
    if (!Array.isArray(connections) || connections.length === 0) {
      return NextResponse.json(
        { error: "No organisations granted. Please re-connect and select one." },
        { status: 400 }
      );
    }

    type HasPrimaryRow = { has_primary: boolean };

    // Determine if user already has a primary
    const result: QueryResult<HasPrimaryRow> = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM public.xero_details
         WHERE betterauth_id = $1 AND is_primary = TRUE
       ) AS has_primary`,
      [betterauthId]
    );
    let hasPrimary = result.rows[0]?.has_primary ?? false;

    const accessExpiresAt = new Date(Date.now() + expires_in * 1000);

    // Upsert each tenant
    for (const c of connections) {
      const makePrimary = !hasPrimary;

      await pool.query(
        `
        INSERT INTO public.xero_details (
          betterauth_id,
          tenant_id,
          tenant_name,
          tenant_type,
          connection_id,
          scope,
          access_token,
          refresh_token,
          id_token,
          token_type,
          access_token_expires_at,
          last_refreshed_at,
          is_connected,
          is_primary
        )
        VALUES (
          $1, $2::uuid, $3, $4, $5::uuid,
          $6, $7, $8, $9, $10,
          $11, NOW(), TRUE, $12
        )
        ON CONFLICT (betterauth_id, tenant_id)
        DO UPDATE SET
          scope                      = EXCLUDED.scope,
          access_token               = EXCLUDED.access_token,
          refresh_token              = EXCLUDED.refresh_token,
          id_token                   = EXCLUDED.id_token,
          token_type                 = EXCLUDED.token_type,
          access_token_expires_at    = EXCLUDED.access_token_expires_at,
          last_refreshed_at          = EXCLUDED.last_refreshed_at,
          is_connected               = TRUE
        `,
        [
          betterauthId,
          c.tenantId,
          c.tenantName,
          c.tenantType,
          c.id,
          scope,
          access_token,
          refresh_token,
          id_token ?? null,
          token_type ?? "Bearer",
          accessExpiresAt,
          makePrimary,
        ]
      );

      if (makePrimary) hasPrimary = true;
    }

    // Success: clear the nonce cookie and redirect to the welcome page
    const res = NextResponse.redirect(new URL(`/welcome?userID=${encodeURIComponent(betterauthId)}`, origin).toString(), 302);
    res.cookies.set({
      name: NONCE_COOKIE,
      value: "",
      httpOnly: true,
      secure: origin.startsWith("https://"),
      sameSite: "lax",
      path: "/api/xero/receive-xero-connection",
      maxAge: 0,
    });
    return res;
  } catch (err: any) {
    console.error("[/api/xero/receive-xero-connection] error:", err?.stack || err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
