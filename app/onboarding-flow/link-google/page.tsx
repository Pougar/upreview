// app/onboarding-flow/link-google/page.tsx
"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/app/lib/auth-client";

/* ===== config & APIs (unchanged) ===== */
const NEXT_STEP_API = "/api/next-user-step";
const CURRENT_ACTION = "google_connected" as const;
const CURRENT_PAGE_URL = "/onboarding-flow/link-google";
const HAS_CONN_API = "/api/google/has-connection";
const ACTION_API = "/api/add-user-action/google-connection";
/* ==================================== */

export default function LinkGooglePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending } = authClient.useSession();

  const authUserIdFromQuery = searchParams.get("userID") ?? "";
  const authUserId = authUserIdFromQuery || session?.user?.id || "";

  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [scopeOk, setScopeOk] = useState<boolean | null>(null);
  const postedRef = useRef(false);

  const mismatch = useMemo(() => {
    if (!authUserIdFromQuery || isPending) return false;
    const sid = session?.user?.id ?? "";
    return !!sid && authUserIdFromQuery !== sid;
  }, [authUserIdFromQuery, isPending, session?.user?.id]);

  const connectDisabled = isPending || checking || !authUserId || mismatch;

  const recordGoogleConnectedAction = useCallback(async () => {
    if (postedRef.current) return;
    postedRef.current = true;
    try {
      await fetch(ACTION_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "include",
        body: JSON.stringify({ userId: authUserId }),
      });
    } catch {
      /* non-fatal */
    }
  }, [authUserId]);

  const checkConnection = useCallback(async () => {
    if (!authUserId) return;
    setChecking(true);
    setError(null);
    try {
      const res = await fetch(
        `${HAS_CONN_API}?betterauth_id=${encodeURIComponent(authUserId)}`,
        { method: "GET", credentials: "include", cache: "no-store" }
      );
      if (!res.ok) throw new Error(`check failed (${res.status})`);

      const json = (await res.json().catch(() => ({}))) as {
        connected?: boolean;
        scopeOk?: boolean;
      };

      setConnected(!!json?.connected);
      setScopeOk(!!json?.scopeOk);

      if (json?.connected) {
        await recordGoogleConnectedAction();
      }
      if (json?.connected && json?.scopeOk) {
        router.replace(`/onboarding-flow/onboarding?UserID=${encodeURIComponent(authUserId)}`);
      }
    } catch (e: any) {
      setError(e?.message || "Could not verify Google connection.");
      setConnected(false);
      setScopeOk(false);
    } finally {
      setChecking(false);
    }
  }, [authUserId, router, recordGoogleConnectedAction]);

  useEffect(() => {
    if (isPending || !authUserId) return;
    void checkConnection();
  }, [authUserId, isPending, checkConnection]);

  const onConnect = useCallback(async () => {
    if (!authUserId) return;
    setError(null);
    await authClient.linkSocial({
      provider: "google",
      scopes: ["https://www.googleapis.com/auth/business.manage"],
      callbackURL: `/onboarding-flow/link-google?userID=${encodeURIComponent(authUserId)}`,
    });
  }, [authUserId]);

  const onDisconnect = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/google/disconnect", { method: "POST" });
      if (!res.ok) throw new Error(`disconnect failed (${res.status})`);
      setConnected(false);
      setScopeOk(false);
      postedRef.current = false;
    } catch (e: any) {
      setError(e?.message || "Failed to disconnect Google.");
    }
  }, []);

  return (
    <div className="bg-white text-slate-900">
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        {/* Brand chip */}
        <div className="mb-5">
          <span className="rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
            upreview
          </span>
        </div>

        {/* Title & subtitle */}
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Link your Google account</h1>
        <p className="mt-2 text-sm text-slate-600">
          Connect the Google account that owns or manages your Business Profile so we can securely
          fetch reviews and help you reply.
        </p>

        {/* Status + actions */}
        <div className="mt-6 space-y-4">
          {/* Status line */}
          <div className="min-h-[1.25rem] text-sm" aria-live="polite">
            {isPending || checking ? (
              <div className="h-4 w-36 animate-pulse rounded bg-slate-200" />
            ) : mismatch ? (
              <p className="text-rose-700">
                The link you opened is for a different user. Please sign in with the correct account.
              </p>
            ) : error ? (
              <p className="text-amber-800">{error}</p>
            ) : connected === true ? (
              <p className="text-emerald-700">
                Google connected{scopeOk ? " with Business Profile access ✓" : " — grant Business Profile access to continue."}
              </p>
            ) : connected === false ? (
              <p className="text-slate-700">Not connected yet.</p>
            ) : null}
          </div>

          {/* Primary button */}
          <button
            type="button"
            onClick={onConnect}
            disabled={connectDisabled}
            aria-disabled={connectDisabled}
            className={`inline-flex items-center justify-center rounded-lg px-5 py-3 text-sm font-semibold transition
              ${connectDisabled ? "bg-slate-200 text-slate-500 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}
          >
            {connected ? (scopeOk ? "Reconnect / Manage Google" : "Grant Business Profile access") : "Connect Google Business"}
          </button>

          {/* Light secondary actions */}
          <div className="flex items-center gap-3 text-sm">
            <button
              type="button"
              onClick={checkConnection}
              disabled={isPending || checking}
              className={`underline-offset-2 hover:underline ${
                isPending || checking ? "text-slate-400 cursor-not-allowed" : "text-slate-700"
              }`}
            >
              {checking ? "Checking…" : "Recheck"}
            </button>
            {connected ? (
              <button
                type="button"
                onClick={onDisconnect}
                className="text-slate-700 underline-offset-2 hover:underline"
              >
                Disconnect
              </button>
            ) : null}
          </div>

          {/* Footnote */}
          <p className="pt-2 text-xs text-slate-500">
            We request the <code>business.manage</code> scope to list locations, read reviews, and manage replies.
            You can revoke access at any time.
          </p>
        </div>
      </div>
    </div>
  );
}
