// app/link-xero/page.tsx
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/app/lib/auth-client";

/* ===== Onboarding flow guard (kept for parity) ===== */
const NEXT_STEP_API = "/api/next-user-step";
const CURRENT_ACTION = "xero_connected" as const;
const CURRENT_PAGE_URL = "/link-xero";
/* ================================================ */

const CONNECT_API = "/api/xero/connect-to-xero";
const HAS_CONN_API = "/api/xero/has-xero-connection"; // returns { connected: boolean }

export default function LinkXeroPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data: session, isPending } = authClient.useSession();

  const authUserIdFromQuery = searchParams.get("userID") ?? "";
  const authUserId = authUserIdFromQuery || session?.user?.id || "";

  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = useMemo(() => {
    if (!authUserIdFromQuery || isPending) return false;
    const sid = session?.user?.id ?? "";
    return !!sid && authUserIdFromQuery !== sid;
  }, [authUserIdFromQuery, isPending, session?.user?.id]);

  const connectDisabled = isPending || checking || !authUserId || mismatch;

  /* ---------- Xero connection status ---------- */
  useEffect(() => {
    if (isPending || !authUserId) return;

    let alive = true;
    (async () => {
      try {
        setChecking(true);
        setError(null);

        const res = await fetch(
          `${HAS_CONN_API}?betterauth_id=${encodeURIComponent(authUserId)}`,
          { method: "GET", credentials: "include", cache: "no-store" }
        );
        if (!res.ok) throw new Error(`check failed (${res.status})`);

        const json = (await res.json().catch(() => ({}))) as { connected?: boolean };
        if (alive && json?.connected === true) {
          router.replace(`/onboarding-flow/welcome?UserID=${encodeURIComponent(authUserId)}`);
        }
      } catch (e: any) {
        if (alive) setError(e?.message || "Could not verify Xero connection.");
      } finally {
        if (alive) setChecking(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [authUserId, isPending, router]);

  const onConnect = useCallback(() => {
    if (!authUserId) return;
    const url = `${CONNECT_API}?betterauth_id=${encodeURIComponent(authUserId)}`;

    // Open a blank tab synchronously (less likely to be blocked)
    const newTab = window.open("", "_blank");
    if (newTab) {
      try {
        // @ts-ignore
        newTab.opener = null; // detach the opener
      } catch {}
      newTab.location.href = url; // Navigate ONLY the new tab
    } else {
      setError("Popup blocked. Please allow pop-ups for this site and try again.");
    }
  }, [authUserId]);

  return (
    <div className="bg-white text-slate-900">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        {/* Brand */}
        <div className="mb-5">
          <span className="rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
            upreview
          </span>
        </div>

        {/* Title & copy */}
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Link your Xero account
        </h1>
        <p className="mt-2 text-sm text-slate-600 max-w-prose">
          Connect your Xero organisation so we can securely fetch invoices and keep your client list in sync.
        </p>

        {/* Status line */}
        <div className="mt-6 min-h-[1.5rem]" aria-live="polite">
          {isPending || checking ? (
            <div className="h-5 w-40 animate-pulse rounded-md bg-slate-200" />
          ) : mismatch ? (
            <p className="text-sm text-rose-700">
              The link you opened is for a different user. Please sign in with the correct account or use the right link.
            </p>
          ) : error ? (
            <p className="text-sm text-amber-800">{error}</p>
          ) : null}
        </div>

        {/* Primary action */}
        <div className="mt-2">
          <button
            type="button"
            onClick={onConnect}
            disabled={connectDisabled}
            aria-disabled={connectDisabled}
            className={`rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition ${
              connectDisabled ? "bg-blue-300 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            Connect to Xero
          </button>
        </div>

        {/* Footnotes */}
        <div className="mt-8 space-y-1.5 text-xs text-slate-500 max-w-prose">
          <p>
            By connecting, you agree to share invoice metadata from your Xero organisation with this application.
          </p>
          <p>
            We only read invoices from your business. Client names, phone numbers and emails are securely stored in our database.
            No other information is accessed or stored.
          </p>
        </div>
      </div>
    </div>
  );
}
