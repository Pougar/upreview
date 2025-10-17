// app/lib/onboarding-flow-guard.ts
import "server-only";
import { redirect } from "next/navigation";

const NEXT_STEP_API = "http://localhost:3000/api/next-user-step";
const NO_USERID_ROUTES = ["/log-in", "/login"]; // never append ?UserID for these

function shouldAppendUserId(targetPath: string) {
  return !NO_USERID_ROUTES.some(
    (p) => targetPath === p || targetPath.startsWith(p + "/")
  );
}

type NextStepResponse = {
  success?: boolean;
  redirect?: string | null;           // e.g. "/onboarding-flow/onboarding"
  next_action?: string | null;        // optional
  status?: "complete" | "incomplete"; // optional
};

/**
 * Enforce onboarding progress for a user.
 * - Calls /api/next-user-step
 * - If a redirect path is returned, navigates there
 * - Appends ?UserID=... to *most* redirects (not to /log-in or /login)
 */
export async function enforceOnboardingOrRedirect(userId: string) {
  if (!userId) return;

  const res = await fetch(NEXT_STEP_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    // server fetch ignores credentials; fine for same-origin APIs
    body: JSON.stringify({ userId }),
  });

  if (!res.ok) return;

  const json = (await res.json().catch(() => ({}))) as NextStepResponse;

  // If API indicates a destination, go there.
  if (json?.redirect) {
    const target = json.redirect;
    const url = shouldAppendUserId(target)
      ? `${target}?UserID=${encodeURIComponent(userId)}`
      : target;
    redirect(url);
  }

  // If no redirect returned -> considered "complete" for our purposes.
}
