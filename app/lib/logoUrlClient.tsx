"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";

type LogoUrlContextValue = {
  url: string | null;        // current signed URL (with a cache-buster)
  isLoading: boolean;        // fetch in-flight
  refresh: () => Promise<void>; // force-refresh (handy for <img onError>)
};

const LogoUrlContext = createContext<LogoUrlContextValue | null>(null);

async function fetchSigned(userId: string) {
  const res = await fetch("/api/retrieve-logo-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("logo-url fetch failed");
  return (await res.json()) as { url: string | null; expiresIn: number; expiresAt?: number | null };
}

export function LogoUrlProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = (expiresIn: number) => {
    // Refresh ~60s before expiry, but never sooner than 30s from now
    const refreshInMs = Math.max(30, expiresIn - 60) * 1000;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // fire-and-forget refresh; errors are handled in refresh()
      void refresh();
    }, refreshInMs);
  };

  const refresh = async () => {
    if (!userId) {
      setUrl(null);
      return;
    }
    setIsLoading(true);
    try {
      const { url: signedUrl, expiresIn } = await fetchSigned(userId);
      if (signedUrl) {
        // add a cache-buster so we never reuse a stale signed URL
        setUrl(`${signedUrl}&cb=${Date.now()}`);
        schedule(expiresIn);
      } else {
        setUrl(null);
        if (timerRef.current) clearTimeout(timerRef.current);
      }
    } catch (e) {
      console.error("[LogoUrlProvider] failed to refresh signed URL:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // when userId changes, clear existing timer and fetch a fresh URL
    if (timerRef.current) clearTimeout(timerRef.current);
    void refresh();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return (
    <LogoUrlContext.Provider value={{ url, isLoading, refresh }}>
      {children}
    </LogoUrlContext.Provider>
  );
}

export function useLogoUrl() {
  const ctx = useContext(LogoUrlContext);
  if (!ctx) throw new Error("useLogoUrl must be used within <LogoUrlProvider>");
  return ctx;
}
