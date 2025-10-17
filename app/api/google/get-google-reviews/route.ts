// app/api/google/get-google-reviews/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // ssl: { rejectUnauthorized: false }, // uncomment if your DB needs SSL
});

// ---- Env helpers ----
function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// ---- Types used from BetterAuth "account" table (camelCase) ----
type AccountRow = {
  id: string;
  providerId: string;   // "google"
  userId: string;       // <-- link to your users
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: string | null; // ISO string
};

// ---- Google endpoints (Business Profile API v4) ----
const GOOGLE_ACCOUNTS_URL = "https://mybusiness.googleapis.com/v4/accounts";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

// Normalize text: trim blanks -> null
function cleanText(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

// Simple helper to parse possibly-enum or numeric stars to number 1..5
function toStarNumber(input: any): number | null {
  if (input == null) return null;
  if (typeof input === "number") {
    if (Number.isFinite(input)) return Math.max(1, Math.min(5, Math.round(input)));
    return null;
  }
  const s = String(input).trim().toUpperCase();
  const map: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  if (s in map) return map[s];
  const n = Number(s);
  return Number.isFinite(n) ? Math.max(1, Math.min(5, Math.round(n))) : null;
}

// Refresh access token with the Google OAuth endpoint
async function refreshAccessToken(refreshToken: string) {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const resp = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Google token refresh failed (${resp.status}): ${t}`);
  }

  const json = await resp.json();
  const accessToken = json.access_token as string;
  const expiresAt = new Date(Date.now() + (Number(json.expires_in ?? 3600) * 1000));
  return { accessToken, expiresAt };
}

async function getValidAccessTokenForUser(userId: string): Promise<string> {
  const { rows } = await pool.query<AccountRow>(
    `
      SELECT id, providerId, userId, accessToken, refreshToken, expiresAt
      FROM public.account
      WHERE userId = $1 AND providerId = 'google'
      ORDER BY "updatedAt" DESC NULLS LAST
      LIMIT 1
    `,
    [userId]
  );

  if (rows.length === 0) throw new Error("No Google account found for this user.");

  const row = rows[0];
  const now = Date.now();
  const exp = row.expiresAt ? new Date(row.expiresAt).getTime() : 0;
  const isExpired = !row.accessToken || !exp || exp - now < 60_000;

  if (!isExpired && row.accessToken) return row.accessToken;
  if (!row.refreshToken) throw new Error("Missing refresh token for this Google account.");

  const { accessToken, expiresAt } = await refreshAccessToken(row.refreshToken);

  await pool.query(
    `
      UPDATE public.account
      SET "accessToken" = $1, "expiresAt" = $2, "updatedAt" = NOW()
      WHERE id = $3
    `,
    [accessToken, expiresAt.toISOString(), row.id]
  );

  return accessToken;
}

// Fetch helper that throws on non-OK
async function gfetch(url: string, accessToken: string) {
  const resp = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Google API ${url} failed (${resp.status}): ${txt}`);
  }
  return resp.json();
}

// List all accounts for token
async function listAccounts(accessToken: string) {
  const data = await gfetch(GOOGLE_ACCOUNTS_URL, accessToken);
  return Array.isArray(data?.accounts) ? data.accounts : [];
}

// List locations for an account (paginate)
async function listAllLocationsForAccount(accountName: string, accessToken: string) {
  const out: any[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`https://mybusiness.googleapis.com/v4/${accountName}/locations`);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const data = await gfetch(url.toString(), accessToken);
    const locs = Array.isArray(data?.locations) ? data.locations : [];
    out.push(...locs);
    pageToken = data?.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

// List reviews for a location (paginate)
async function listAllReviewsForLocation(accountName: string, locationName: string, accessToken: string) {
  const out: any[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`https://mybusiness.googleapis.com/v4/${accountName}/${locationName}/reviews`);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const data = await gfetch(url.toString(), accessToken);
    const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
    out.push(...reviews);
    pageToken = data?.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

export async function POST(req: NextRequest) {
  let client;
  try {
    const { userId } = (await req.json().catch(() => ({}))) as { userId?: string };
    if (!userId) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }

    const accessToken = await getValidAccessTokenForUser(userId);
    const accounts = await listAccounts(accessToken);

    client = await pool.connect();
    await client.query("BEGIN");

    const upsertSql = `
      INSERT INTO public.google_reviews (id, user_id, name, review, stars)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        name    = COALESCE(NULLIF(btrim(EXCLUDED.name), ''), public.google_reviews.name),
        review  = COALESCE(NULLIF(btrim(EXCLUDED.review), ''), public.google_reviews.review),
        stars   = COALESCE(EXCLUDED.stars, public.google_reviews.stars)
      WHERE
        (public.google_reviews.user_id, public.google_reviews.name, public.google_reviews.review, public.google_reviews.stars)
          IS DISTINCT FROM
        (EXCLUDED.user_id, EXCLUDED.name, EXCLUDED.review, EXCLUDED.stars)
    `;

    let foundCount = 0;
    let upserted = 0;

    for (const acc of accounts) {
      const accountName: string | undefined = acc?.name; // "accounts/123..."
      if (!accountName) continue;

      const locations = await listAllLocationsForAccount(accountName, accessToken);

      for (const loc of locations) {
        const locationName: string | undefined = loc?.name; // "locations/456..."
        if (!locationName) continue;

        const reviews = await listAllReviewsForLocation(accountName, locationName, accessToken);

        for (const r of reviews) {
          const reviewId: string | undefined = r?.reviewId || r?.name || undefined;
          if (!reviewId) continue;

          const reviewerName = cleanText(r?.reviewer?.displayName ?? r?.reviewer?.name);
          const reviewText   = cleanText(r?.comment ?? r?.text);
          const stars        = toStarNumber(r?.starRating);

          foundCount++;

          const res = await client.query(upsertSql, [
            String(reviewId),
            userId,
            reviewerName,
            reviewText,
            stars,
          ]);

          // res.rowCount === 1 for insert; === 1 for update if WHERE matched; === 0 when ON CONFLICT skipped due to WHERE
          if (res.rowCount && res.rowCount > 0) upserted++;
        }
      }
    }

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      userId,
      accounts: accounts.length,
      reviewsFound: foundCount,
      rowsInsertedOrUpdated: upserted,
    });
  } catch (err: any) {
    if (client) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    console.error("[get-google-reviews] error:", err?.stack || err);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  } finally {
    if (client) client.release();
  }
}
