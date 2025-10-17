// app/onboarding-flow/layout.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/app/lib/auth-client";

const NEXT_STEP_API = "/api/next-user-step";
const NO_USERID_ROUTES = ["/log-in", "/login"]; // never append ?UserID for these

type StageKey =
  | "sign-up"
  | "connect-google"
  | "user-details"
  | "connect-xero"
  | "welcome";

const STAGES: { key: StageKey; label: string; routes: string[] }[] = [
  { key: "sign-up",        label: "Sign Up",        routes: ["/app/sign-up", "/log-in", "/login"] },
  { key: "connect-google", label: "Connect Google", routes: ["/onboarding-flow/link-google"] },
  { key: "user-details",   label: "User Details",   routes: ["/onboarding-flow/onboarding"] },
  { key: "connect-xero",   label: "Connect Xero",   routes: ["/onboarding-flow/link-xero"] },
  { key: "welcome",        label: "Welcome",        routes: ["/onboarding-flow/welcome"] },
];

function inferStageIndexFromPath(pathname?: string | null): number {
  if (!pathname) return 0;
  const idx = STAGES.findIndex(s => s.routes.some(r => pathname.startsWith(r)));
  return idx >= 0 ? idx : 0;
}

function shouldAppendUserId(targetPath: string) {
  return !NO_USERID_ROUTES.some(
    (p) => targetPath === p || targetPath.startsWith(p + "/")
  );
}

export default function OnboardingFlowLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { data: session, isPending } = authClient.useSession();

  // Prefer ?UserID, fallback to ?userID, then session
  const qpUpper = search.get("UserID") ?? "";
  const qpLower = search.get("userID") ?? "";
  const userId = qpUpper || qpLower || session?.user?.id || "";

  // highlight based on current route
  const currentStageIdx = useMemo(() => inferStageIndexFromPath(pathname), [pathname]);

  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const checkNextStep = useCallback(async () => {
    if (!userId) return;
    setChecking(true);
    setCheckError(null);
    try {
      const res = await fetch(NEXT_STEP_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "include",
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) return;

      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        redirect?: string | null;
        next_action?: string | null;
        status?: "complete" | "incomplete";
      };

      const target = json?.redirect;
      if (target && !pathname.startsWith(target)) {
        if (shouldAppendUserId(target)) {
          router.replace(`${target}?UserID=${encodeURIComponent(userId)}`);
        } else {
          router.replace(target);
        }
      }
    } catch (e: any) {
      setCheckError(e?.message || "Could not verify next step");
    } finally {
      setChecking(false);
    }
  }, [pathname, router, userId]);

  useEffect(() => {
    if (isPending) return;
    if (!userId) return;
    checkNextStep();
  }, [isPending, userId, pathname, checkNextStep]);

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col">
      {/* Slim sticky header with brand + stepper */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="mx-auto max-w-6xl w-full px-4 sm:px-6">
          <div className="flex items-center justify-between gap-4 py-3">
            {/* Brand + small caption (left-aligned to echo the sign-up page) */}
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
                upreview
              </span>
              <span className="hidden sm:inline text-xs text-slate-500">
                Guided onboarding
              </span>
            </div>

            {/* Progress text (mobile) */}
            <div className="sm:hidden text-xs font-medium text-slate-700">
              {checking
                ? "Checking your progress…"
                : checkError
                ? "Couldn’t verify progress — you can continue."
                : `Step ${currentStageIdx + 1} of ${STAGES.length}`}
            </div>
          </div>

          {/* Stepper */}
          <div className="pb-3">
            <Stepper current={currentStageIdx + 1} labels={STAGES.map(s => s.label)} />
            <p className="mt-1 hidden sm:block text-center text-xs font-medium text-slate-600" aria-live="polite">
              {checking
                ? "Checking your progress…"
                : checkError
                ? "Couldn’t verify progress — you can continue."
                : `Step ${currentStageIdx + 1} of ${STAGES.length}`}
            </p>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1">{children}</main>
    </div>
  );
}

/* ---------- Refined Stepper (style-only; logic unchanged) ---------- */
function Stepper({ current, labels }: { current: number; labels: string[] }) {
  const total = labels.length;
  const clamped = Math.max(1, Math.min(current, total));
  // Progress ratio for the bar: 0 at start, 1 at end
  const ratio = total <= 1 ? 1 : (clamped - 1) / (total - 1);

  return (
    <div className="relative">
      {/* Track */}
      <div className="absolute left-4 right-4 top-1/2 -translate-y-1/2 h-1 rounded-full bg-slate-200" />

      {/* Progress fill */}
      <div
        className="absolute left-4 top-1/2 -translate-y-1/2 h-1 rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 transition-[width]"
        style={{ width: `calc(${ratio * 100}% - 0rem)` }}
      />

      {/* Steps (grid rendered via inline style to avoid Tailwind grid-cols safelist issues) */}
      <div
        className="relative mx-4"
        style={{ display: "grid", gridTemplateColumns: `repeat(${total}, minmax(0,1fr))`, gap: "0.5rem" }}
      >
        {labels.map((label, idx) => {
          const step = idx + 1;
          const state = step < clamped ? "complete" : step === clamped ? "current" : "upcoming";

          const badgeBase =
            "flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold ring-2 transition";
          const badgeStyles =
            state === "complete"
              ? "bg-emerald-600 text-white ring-emerald-300 shadow-sm"
              : state === "current"
              ? "bg-blue-600 text-white ring-blue-300 shadow-sm"
              : "bg-slate-200 text-slate-600 ring-slate-300";

          const dotAria =
            state === "current" ? { "aria-current": "step" as const } : {};

          return (
            <div key={label} className="flex flex-col items-center gap-1 py-1 text-center">
              <div className={`${badgeBase} ${badgeStyles}`} {...dotAria}>
                {step}
              </div>
              <span className="line-clamp-1 text-[11px] text-slate-600">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
