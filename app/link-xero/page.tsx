// app/link-xero/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/app/lib/auth-client";

const CONNECT_API = "/api/xero/connect-to-xero";
const HAS_CONN_API = "/api/xero/has-xero-connection"; // expected to return { connected: boolean }

export default function LinkXeroPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Session (same hook as your onboarding page)
  const { data: session, isPending } = authClient.useSession();

  // userID: prefer query param, fallback to session
  const authUserIdFromQuery = searchParams.get("userID") ?? "";
  const authUserId = authUserIdFromQuery || session?.user?.id || "";
  const accountEmail = session?.user?.email ?? "";

  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guard: if a userID is in the URL, ensure it matches the session user id
  const mismatch = useMemo(() => {
    if (!authUserIdFromQuery) return false;
    if (isPending) return false;
    const sid = session?.user?.id ?? "";
    return !!sid && authUserIdFromQuery !== sid;
  }, [authUserIdFromQuery, isPending, session?.user?.id]);

  // If already connected, bounce to /welcome?UserID=...
  useEffect(() => {
    if (isPending) return;
    if (!authUserId) return;
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
        const json = await res.json().catch(() => ({} as any));
        if (alive && json?.connected === true) {
          router.replace(`/welcome?UserID=${encodeURIComponent(authUserId)}`);
        }
      } catch (e: any) {
        // Non-fatal; user can still connect. Surface minimal error.
        if (alive) setError(e?.message || "Could not verify Xero connection.");
      } finally {
        if (alive) setChecking(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [authUserId, isPending, router]);

  const onConnect = () => {
    if (!authUserId) return;
    // Start OAuth: server will handle nonce/state + redirect to Xero
    const url = `${CONNECT_API}?betterauth_id=${encodeURIComponent(authUserId)}`;
    window.location.href = url;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex flex-col">
      {/* Sticky timeline header (Step 2 of 3) */}
      <div className="sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-white/50 bg-white/70 border-b border-white/60">
        <div className="mx-auto max-w-5xl px-6 py-3">
          <Stepper current={2} labels={["Set up account", "Link services", "Review overview"]} />
          <p className="mt-1 text-xs font-medium text-gray-700 text-center">Step 2 of 3</p>
        </div>
      </div>

      {/* Centered content (logic unchanged) */}
      <main className="flex-1 p-6 flex items-center justify-center">
        <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5">
          <h1 className="text-2xl font-bold text-gray-800">Link your Xero account</h1>
          <p className="mt-2 text-sm text-gray-600">
            Connect your Xero organisation so we can securely fetch invoices.
          </p>

          <div className="mt-6 rounded-xl border border-gray-200 p-4">
            <dl className="grid grid-cols-1 gap-2 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-gray-600">Signed in as</dt>
                <dd className="font-medium text-gray-900">
                  {accountEmail || "(unknown email)"}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-gray-600">User ID</dt>
                <dd className="font-mono text-gray-900">{authUserId || "—"}</dd>
              </div>
            </dl>

            {isPending || checking ? (
              <div className="mt-4 h-9 w-40 animate-pulse rounded-lg bg-gray-200" />
            ) : mismatch ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                The link you opened is for a different user. Please sign in with the correct
                account or use the right link.
              </div>
            ) : error ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {error}
              </div>
            ) : null}

            <div className="mt-6">
              <button
                type="button"
                onClick={onConnect}
                disabled={isPending || checking || !authUserId || mismatch}
                className={`rounded-lg px-5 py-2.5 text-sm font-medium shadow focus:outline-none focus:ring-2
                  ${
                    isPending || checking || !authUserId || mismatch
                      ? "cursor-not-allowed bg-gray-200 text-gray-500 ring-gray-300"
                      : "bg-blue-600 text-white hover:bg-blue-700 ring-blue-400"
                  }`}
                aria-disabled={isPending || checking || !authUserId || mismatch}
              >
                Connect to Xero
              </button>
            </div>
          </div>

          <p className="mt-3 text-xs text-gray-500">
            By connecting, you agree to share invoice metadata from your Xero organisation with this application.
          </p>
          {/* Privacy note you requested */}
          <p className="mt-1 text-xs text-gray-500">
            we are only able to read invoices from your business. Client names, phone numbers and emails are securely stored in our database. No other information is accessed or stored.
          </p>
        </div>
      </main>
    </div>
  );
}

/* ---------- Stepper (visual only) ---------- */
function Stepper({
  current,
  labels,
}: {
  current: 1 | 2 | 3;
  labels: [string, string, string] | string[];
}) {
  return (
    <div className="relative">
      <div className="absolute left-4 right-4 top-1/2 -translate-y-1/2 h-1 bg-gray-200 rounded-full" />
      <div
        className="absolute left-4 top-1/2 -translate-y-1/2 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-500 rounded-full transition-all"
        style={{ right: `${(3 - current) * 33.3333 + 4}px` }}
      />
      <div className="relative grid grid-cols-3">
        {[1, 2, 3].map((step, idx) => {
          const state =
            step < current ? "complete" : step === current ? "current" : "upcoming";
          const label = labels[idx] ?? `Step ${step}`;
          return (
            <div key={step} className="flex flex-col items-center gap-1 py-1">
              <div
                className={[
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ring-2 transition",
                  state === "complete" &&
                    "bg-emerald-600 text-white ring-emerald-300 shadow-sm",
                  state === "current" && "bg-blue-600 text-white ring-blue-300 shadow-sm",
                  state === "upcoming" && "bg-gray-200 text-gray-600 ring-gray-300",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-current={state === "current" ? "step" : undefined}
              >
                {step}
              </div>
              <span className="text-[11px] text-gray-600">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
