// lib/checkSessionServer.ts
import { auth } from "@/app/lib/auth";
import { headers as nextHeaders } from "next/headers";

/** Convert Next 15 ReadonlyHeaders (possibly Promise-wrapped) into Fetch Headers */
async function getNodeHeaders(): Promise<Headers> {
  const h = await Promise.resolve(nextHeaders() as any); // ReadonlyHeaders
  return new Headers(Object.fromEntries(h.entries()));
}

export async function checkSessionServer(username: string) {
  // 1) Build Headers for Better Auth
  const requestHeaders = await getNodeHeaders();

  // 2) Get session from Better Auth (reads cookies from headers)
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user) {
    return { valid: false as const, reason: "Invalid session" };
  }

  // 3) Call your get-name endpoint to fetch both slug (name) and display_name
  const proto =
    requestHeaders.get("x-forwarded-proto") ??
    requestHeaders.get("x-proto") ??
    "http";
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!host) return { valid: false as const, reason: "Missing host header" };

  const nameURL = new URL("/api/get-name", `${proto}://${host}`).toString();

  const nameRes = await fetch(nameURL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: requestHeaders.get("cookie") ?? "",
    },
    body: JSON.stringify({ id: session.user.id }),
    cache: "no-store",
  });

  if (!nameRes.ok) {
    return { valid: false as const, reason: "Failed to fetch user name" };
  }

  // Support both shapes:
  const payload: any = await nameRes.json().catch(() => ({}));
  const urlSafeName: string | undefined =
    payload?.user?.name ?? payload?.name;
  const displayName: string | undefined =
    payload?.user?.display_name ?? payload?.display_name;

  if (!urlSafeName) {
    return { valid: false as const, reason: "No name found" };
  }

  if (urlSafeName !== username) {
    return {
      valid: false as const,
      reason: "Username mismatch",
      expected: urlSafeName,
      display_name: displayName ?? null,
      user_id: session.user.id, // still return user_id for convenience
    };
  }

  // ✅ Match OK — return both values + user_id
  return {
    valid: true as const,
    name: urlSafeName,
    display_name: displayName ?? null,
    user_id: session.user.id, // BetterAuth user ID (betterauth_id)
  };
}
