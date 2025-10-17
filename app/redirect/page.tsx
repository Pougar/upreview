// app/redirect/page.tsx
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const STORAGE_KEY = "pendingGoogleReviewRedirect";

function tryCopy(text: string) {
  if (!text) return Promise.resolve(false);
  return navigator.clipboard
    .writeText(text)
    .then(() => true)
    .catch(async () => {
      // Fallback for older browsers
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    });
}

export default function GoogleRedirectPage() {
  const router = useRouter();
  const search = useSearchParams();

  // Optional URL override or seconds via query (e.g. /reviews/redirect?url=...&s=7)
  const urlFromQuery = search.get("url") || "";
  const secondsFromQuery = parseInt(search.get("s") || "", 10);
  const initialSeconds = Number.isFinite(secondsFromQuery) && secondsFromQuery > 0 ? secondsFromQuery : 5;

  const [targetUrl, setTargetUrl] = useState<string>("");
  const [copied, setCopied] = useState<boolean | null>(null);
  const [seconds, setSeconds] = useState(initialSeconds);

  // Load payload from sessionStorage
  useEffect(() => {
    let url = urlFromQuery;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const payload = JSON.parse(raw) as { url?: string; review?: string };
        if (payload?.url && !url) url = payload.url;
        // Copy review if present
        if (payload?.review) {
          tryCopy(payload.review).then((ok) => setCopied(ok));
        } else {
          setCopied(null);
        }
      } else {
        setCopied(null);
      }
    } catch {
      setCopied(null);
    }
    if (url) setTargetUrl(url);
  }, [urlFromQuery]);

  // Countdown -> redirect
  useEffect(() => {
    if (!targetUrl) return;
    if (seconds <= 0) {
      window.location.href = targetUrl;
      return;
    }
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds, targetUrl]);

  const openNow = useCallback(() => {
    if (!targetUrl) return;
    window.location.href = targetUrl;
  }, [targetUrl]);

  const copyAgain = useCallback(async () => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      const payload = raw ? (JSON.parse(raw) as { review?: string }) : null;
      const ok = await tryCopy(payload?.review || "");
      setCopied(ok);
    } catch {
      setCopied(false);
    }
  }, []);

  const message = useMemo(() => {
    if (!targetUrl) {
      return "We couldn't find a Google reviews link.";
    }
    return `Your review has been copied to the clipboard${
      copied === false ? " (copy failed)" : copied === true ? " ✓" : ""
    }. You will be redirected in ${seconds}…`;
  }, [targetUrl, copied, seconds]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">
            Please consider posting your review on Google 🙏
          </h1>
          {/* Optional brand mark or close */}
        </div>

        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.15" strokeWidth="4" />
              <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" />
            </svg>
            <p className="text-sm text-gray-700">{message}</p>
          </div>

          {targetUrl ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openNow}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              >
                Open Google Reviews Now
              </button>
              <button
                type="button"
                onClick={copyAgain}
                className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                Copy Again
              </button>
              <button
                type="button"
                onClick={() => router.back()}
                className="rounded-lg bg-gray-50 px-3 py-1.5 text-sm font-semibold text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => router.back()}
                className="rounded-lg bg-gray-50 px-3 py-1.5 text-sm font-semibold text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                Go Back
              </button>
            </div>
          )}
        </div>

        <p className="mt-3 text-xs text-gray-500">
          If you’re not redirected, click “Open Google Reviews Now.”
        </p>
      </div>
    </div>
  );
}
