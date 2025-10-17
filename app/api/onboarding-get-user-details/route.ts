// app/api/onboarding-get-user-details/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

type AccountRow = {
  userId?: string | null;
  accountId: string;
  providerId: string;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: string | number | null;
  refreshTokenExpiresAt: string | number | null;
  scope?: string | null;
};

type Out = {
  name?: string | null;
  email?: string | null;
  description?: string | null;        // GBP profile.description
  googleBusinessLink?: string | null; // Public Maps listing or website
  googleReviewLink?: string | null;   // Direct “Write a review” URL
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { userId } = body as { userId?: string };
    console.log("[onboarding-get-user-details] incoming userId:", userId);

    if (!userId) {
      console.warn("[onboarding-get-user-details] MISSING_USER_ID");
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }

    // Load the Google-linked account row (BetterAuth table: account)
    const { rows } = await pool.query<AccountRow>(
      `
      SELECT
        "userId",
        "accountId",
        "providerId",
        "accessToken",
        "refreshToken",
        "accessTokenExpiresAt",
        "refreshTokenExpiresAt",
        "scope"
      FROM account
      WHERE ("userId" = $1 OR "accountId" = $1)
        AND "providerId" = 'google'
      LIMIT 1
      `,
      [userId]
    );

    const acct = rows[0];
    if (!acct) {
      console.warn("[onboarding-get-user-details] NO_GOOGLE_LINKED for user:", userId);
      return NextResponse.json({ error: "NO_GOOGLE_LINKED" }, { status: 404 });
    }

    console.log("[onboarding-get-user-details] account found:", {
      providerId: acct.providerId,
      // Do not log tokens
      hasAccessToken: !!acct.accessToken,
      hasRefreshToken: !!acct.refreshToken,
      accessTokenExpiresAt: acct.accessTokenExpiresAt,
      scope: acct.scope,
    });

    // Ensure valid access token (refresh if needed)
    let accessToken = acct.accessToken ?? "";
    if (!accessToken || isExpired(acct.accessTokenExpiresAt)) {
      console.log("[onboarding-get-user-details] Access token missing/expired. Attempting refresh…");
      if (!acct.refreshToken) {
        console.error("[onboarding-get-user-details] EXPIRED_NO_REFRESH (no refresh token)");
        return NextResponse.json({ error: "EXPIRED_NO_REFRESH" }, { status: 401 });
      }
      const refreshed = await refreshGoogleAccessToken(acct.refreshToken);
      accessToken = refreshed.access_token;

      await pool.query(
        `
        UPDATE account
        SET "accessToken" = $1,
            "accessTokenExpiresAt" = $2,
            "refreshToken" = COALESCE($3, "refreshToken")
        WHERE ("userId" = $4 OR "accountId" = $4) AND "providerId" = 'google'
        `,
        [
          refreshed.access_token,
          Date.now() + (refreshed.expires_in ?? 3600) * 1000,
          refreshed.refresh_token ?? null,
          userId,
        ]
      );

      console.log("[onboarding-get-user-details] Token refresh success. New access token stored.");
    } else {
      console.log("[onboarding-get-user-details] Access token still valid.");
    }

    // Authenticated Google fetch with one retry on 401
    const gFetch = makeGoogleFetch(
      () => accessToken,
      async () => {
        console.log("[onboarding-get-user-details] Retrying after 401 with token refresh…");
        if (!rows[0]?.refreshToken) throw new Error("NO_REFRESH_TOKEN");
        const r = await refreshGoogleAccessToken(rows[0].refreshToken!);
        accessToken = r.access_token;
        await pool.query(
          `
          UPDATE account
          SET "accessToken" = $1,
              "accessTokenExpiresAt" = $2,
              "refreshToken" = COALESCE($3, "refreshToken")
          WHERE ("userId" = $4 OR "accountId" = $4) AND "providerId" = 'google'
          `,
          [
            r.access_token,
            Date.now() + (r.expires_in ?? 3600) * 1000,
            r.refresh_token ?? null,
            userId,
          ]
        );
        console.log("[onboarding-get-user-details] Retry token refreshed & saved.");
        return accessToken;
      }
    );

    // 1) OpenID Connect UserInfo → name, email
    const userInfo = await gFetchJson<{ name?: string; email?: string }>(
      gFetch,
      "https://openidconnect.googleapis.com/v1/userinfo"
    );
    console.log("[onboarding-get-user-details] userinfo:", {
      name: userInfo?.name ?? null,
      email: userInfo?.email ?? null,
    });

    // 2) Business Profile (GBP) → accounts → locations
    let description: string | null = null;
    let googleBusinessLink: string | null = null; // mapsUri or websiteUri
    let googleReviewLink: string | null = null;   // newReviewUri or writereview?placeid=

    function parseScopes(raw: unknown): string[] {
      if (!raw) return [];
      // handle "a b c", "a,b,c", "a, b c", arrays, etc.
      if (Array.isArray(raw)) return raw.map(String);
      return String(raw)
        .split(/[,\s]+/)        // split on commas or whitespace
        .map(s => s.trim())
        .filter(Boolean);
    }

    const scopes = parseScopes(acct.scope);
    const hasBusinessScope = scopes.includes("https://www.googleapis.com/auth/business.manage");
    console.log("[onboarding-get-user-details] parsed scopes:", scopes);
    console.log("[onboarding-get-user-details] hasBusinessScope:", hasBusinessScope);

    if (hasBusinessScope) {
      // List accounts
      const accounts = await safeGFetchJson<{ accounts?: { name: string }[] }>(
        gFetch,
        "https://mybusinessaccountmanagement.googleapis.com/v1/accounts"
      );

      const accountCount = accounts?.accounts?.length ?? 0;
      const firstAccountId =
        accounts?.accounts?.[0]?.name?.split("/").pop() ?? null; // "accounts/123" -> "123"

      console.log("[onboarding-get-user-details] accounts:", {
        count: accountCount,
        firstAccountId,
      });

      if (firstAccountId) {
        // Prefer a precise read mask for perf: profile.description + metadata fields we need
        const readMask = "profile(description),metadata(placeId,mapsUri,newReviewUri,listingStatus),websiteUri";
        console.log("[onboarding-get-user-details] locations readMask:", readMask);

        const locs = await safeGFetchJson<{
          locations?: Array<{
            profile?: { description?: string | null } | null;
            websiteUri?: string | null;
            metadata?: {
              mapsUri?: string | null;
              newReviewUri?: string | null;
              placeId?: string | null;
              listingStatus?: string | null;
            } | null;
          }>;
        }>(
          gFetch,
          `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${firstAccountId}/locations?readMask=${encodeURIComponent(
            readMask
          )}`
        );

        const locCount = locs?.locations?.length ?? 0;
        console.log("[onboarding-get-user-details] locations count:", locCount);

        if (locCount > 0) {
          // Prefer a published location if available
          const preferred =
            locs!.locations!.find((l) => l.metadata?.listingStatus === "PUBLISHED") ??
            locs!.locations![0];

          const listingStatus = preferred?.metadata?.listingStatus ?? null;
          const profileDesc = preferred?.profile?.description ?? null;
          const websiteUri = preferred?.websiteUri ?? null;
          const mapsUri = preferred?.metadata?.mapsUri ?? null;
          const newReviewUri = preferred?.metadata?.newReviewUri ?? null;
          const placeId = preferred?.metadata?.placeId ?? null;

          console.log("[onboarding-get-user-details] chosen location fields:", {
            listingStatus,
            profileDesc,
            websiteUri,
            mapsUri,
            newReviewUri,
            placeId,
          });

          description = profileDesc;

          // Business link resolution
          if (mapsUri) {
            googleBusinessLink = mapsUri;
            console.log("[onboarding-get-user-details] googleBusinessLink source: metadata.mapsUri");
          } else if (websiteUri) {
            googleBusinessLink = websiteUri;
            console.log("[onboarding-get-user-details] googleBusinessLink source: websiteUri");
          } else {
            console.log("[onboarding-get-user-details] googleBusinessLink not available (both mapsUri & websiteUri missing).");
            googleBusinessLink = null;
          }

          // Review link resolution
          if (newReviewUri) {
            googleReviewLink = newReviewUri;
            console.log("[onboarding-get-user-details] googleReviewLink source: metadata.newReviewUri");
          } else if (placeId) {
            googleReviewLink = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
            console.log("[onboarding-get-user-details] googleReviewLink constructed from placeId:", googleReviewLink);
          } else {
            googleReviewLink = null;
            console.warn("[onboarding-get-user-details] No review link available (no newReviewUri & no placeId).");
          }
        } else {
          console.warn("[onboarding-get-user-details] No locations returned for account:", firstAccountId);
        }
      } else {
        console.warn("[onboarding-get-user-details] No accounts available under GBP.");
      }
    } else {
      console.warn("[onboarding-get-user-details] Missing business.manage scope; skipping GBP calls.");
    }

    const out: Out = {
      name: userInfo.name ?? null,
      email: userInfo.email ?? null,
      description,
      googleBusinessLink,
      googleReviewLink,
    };

    console.log("[onboarding-get-user-details] final output:", out);
    return NextResponse.json(out);
  } catch (err) {
    console.error("onboarding-get-user-details error:", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}

/* ---------------- Helpers ---------------- */

function isExpired(expiresAt: string | number | null): boolean {
  if (!expiresAt) return true;
  const nowMs = Date.now();
  let expMs: number;
  if (typeof expiresAt === "number") {
    expMs = expiresAt > 1e12 ? expiresAt : expiresAt * 1000;
  } else if (/^\d+$/.test(expiresAt)) {
    const n = Number(expiresAt);
    expMs = n > 1e12 ? n : n * 1000;
  } else {
    const t = Date.parse(expiresAt);
    expMs = Number.isNaN(t) ? 0 : t;
  }
  return expMs - 60_000 <= nowMs; // refresh 60s early
}

function makeGoogleFetch(getToken: () => string, refreshOnce: () => Promise<string>) {
  let tried = false;
  return async (url: string, init?: RequestInit) => {
    const res = await fetch(url, withAuth(getToken(), init));
    if (res.status !== 401 || tried) return res;
    tried = true;
    const newTok = await refreshOnce();
    return fetch(url, withAuth(newTok, init));
  };
}

function withAuth(token: string, init?: RequestInit): RequestInit {
  return {
    ...(init || {}),
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  };
}

async function gFetchJson<T>(
  gFetch: (u: string, i?: RequestInit) => Promise<Response>,
  url: string
): Promise<T> {
  const r = await gFetch(url);
  if (r.ok) return (await r.json()) as T;
  const text = await r.text().catch(() => "");
  console.error("[onboarding-get-user-details] Google API failed:", { url, status: r.status, body: text });
  throw new Error(`Google API ${url} failed ${r.status}: ${text || r.statusText}`);
}

// Treat 403/404 from GBP as "no business" instead of crashing (but log it)
async function safeGFetchJson<T>(
  gFetch: (u: string, i?: RequestInit) => Promise<Response>,
  url: string
): Promise<T | null> {
  const r = await gFetch(url);
  if (r.ok) return (await r.json()) as T;
  const text = await r.text().catch(() => "");
  if (r.status === 403 || r.status === 404) {
    console.warn("[onboarding-get-user-details] GBP call returned non-fatal status:", {
      url,
      status: r.status,
      body: text,
    });
    return null;
  }
  console.error("[onboarding-get-user-details] GBP call failed:", { url, status: r.status, body: text });
  throw new Error(`Google API ${url} failed ${r.status}: ${text || r.statusText}`);
}

async function refreshGoogleAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}> {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    console.error("[onboarding-get-user-details] TOKEN_REFRESH_FAILED:", r.status, text);
    throw new Error(`TOKEN_REFRESH_FAILED ${r.status}: ${text || r.statusText}`);
  }

  const json = (await r.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
  console.log("[onboarding-get-user-details] refreshGoogleAccessToken OK (not logging token contents).");
  return json;
}
