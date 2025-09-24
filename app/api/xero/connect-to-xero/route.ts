// app/api/xero/connect-to-xero/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XERO_AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const NONCE_COOKIE = "xero_oauth_nonce";
const DEFAULT_SCOPES = "offline_access accounting.transactions.read accounting.contacts.read";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function toB64Url(obj: unknown) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function buildReceiveRedirectUri(origin: string) {
  // MUST be registered exactly in your Xero app settings
  return `${origin}/api/xero/receive-xero-connection`;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const origin = url.origin;

    const betterauthId =
      url.searchParams.get("betterauth_id") ||
      url.searchParams.get("betterauthId");
    if (!betterauthId) {
      return NextResponse.json({ error: "Missing betterauth_id" }, { status: 400 });
    }

    // Optional: where to send user after success
    const returnTo = url.searchParams.get("return_to") || "/integrations/xero/success";

    const clientId = requireEnv("XERO_CLIENT_ID");
    const scopes = process.env.XERO_SCOPES || DEFAULT_SCOPES;
    const redirectUri = buildReceiveRedirectUri(origin);

    // CSRF binding: short-lived nonce cookie + state parameter
    const nonce = crypto.randomBytes(16).toString("base64url");
    const state = toB64Url({ betterauthId, returnTo, nonce });

    const authorize = new URL(XERO_AUTHORIZE_URL);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("scope", scopes);
    authorize.searchParams.set("state", state);
    // If you want the org picker every time: authorize.searchParams.set("prompt", "consent");

    const res = NextResponse.redirect(authorize.toString(), 302);
    // Scope the cookie to the receiver route; Lax is included on top-level redirects
    res.cookies.set({
      name: NONCE_COOKIE,
      value: nonce,
      httpOnly: true,
      secure: origin.startsWith("https://"),
      sameSite: "lax",
      path: "/api/xero/receive-xero-connection",
      maxAge: 60 * 5, // 5 minutes
    });
    return res;
  } catch (err: any) {
    console.error("[/api/xero/connect-to-xero] error:", err?.stack || err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
