"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "../UserContext";
import { authClient } from "@/app/lib/auth-client";
import { useLogoUrl } from "@/app/lib/logoUrlClient";

/* ---------------- Types ---------------- */

type Counts = {
  good: number;
  bad: number;
  not_reviewed_yet: number;
};

type RecentReview = {
  client_id: string;
  client_name: string;
  sentiment: "good" | "bad" | "unreviewed" | string;
  review: string;
  updated_at: string; // ISO
};

/* ---------------- Page ---------------- */

export default function DashboardPage() {
  const router = useRouter();

  // Provided by your layout’s <UserProvider />
  const { name, display } = useUser();

  // Keep hook order stable: session hook early
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? null;

  // Logo (signed URL with auto-refresh; falls back if missing)
  const { url: logoUrl } = useLogoUrl();

  /* ----- Statistics (Good/Bad/Unreviewed) ----- */
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(true);

  /* ----- Email template preview ----- */
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [senderName, setSenderName] = useState(display || "");
  const [loadingTpl, setLoadingTpl] = useState(true);

  /* ----- Recent reviews (5 per page from up to latest 10) ----- */
  const [recent, setRecent] = useState<RecentReview[]>([]);
  const [rvLoading, setRvLoading] = useState(true);
  const [rvErr, setRvErr] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(recent.length / pageSize));
  const visible = useMemo(
    () => recent.slice(page * pageSize, page * pageSize + pageSize),
    [recent, page]
  );

  const total = useMemo(
    () => (counts ? counts.good + counts.bad + counts.not_reviewed_yet : 0),
    [counts]
  );


  /* ----- Fetch stats (wait for Xero sync) ----- */
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingCounts(true);
      try {
        const res = await fetch("/api/statistics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        if (!res.ok) throw new Error(`Statistics fetch failed: ${res.status}`);
        const data = await res.json();
        if (alive) setCounts(data ?? { good: 0, bad: 0, not_reviewed_yet: 0 });
      } catch {
        if (alive) setCounts({ good: 0, bad: 0, not_reviewed_yet: 0 });
      } finally {
        if (alive) setLoadingCounts(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  /* ----- Fetch email template (wait for Xero sync) ----- */
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingTpl(true);
      try {
        const res = await fetch("/api/email-template", {
          method: "GET",
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        setSubject(data?.subject ?? "");
        setBody(data?.body ?? "");
        setSenderName(data?.senderName ?? display ?? "");
      } catch {
        if (alive) {
          setSubject("");
          setBody("");
          setSenderName(display ?? "");
        }
      } finally {
        if (alive) setLoadingTpl(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [display]);

  /* ----- Fetch recent reviews (wait for Xero sync & userId) ----- */
  useEffect(() => {
    if (!userId) return; // gate
    let alive = true;
    (async () => {
      setRvLoading(true);
      setRvErr(null);
      try {
        const res = await fetch("/api/get-recent-reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        if (!res.ok) throw new Error(`Failed to load reviews (${res.status})`);
        const data = await res.json().catch(() => ({}));
        const list: RecentReview[] = data?.reviews ?? [];
        if (alive) {
          setRecent(list);
          setPage(0);
        }
      } catch (e: any) {
        if (alive) setRvErr(e?.message || "Failed to load recent reviews.");
      } finally {
        if (alive) setRvLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  return (
    <div className="rounded-2xl min-h-screen flex flex-col items-center">
      {/* Logo (kept minimal; no hero) */}
      <div className="w-32 mb-8">
        <img
          src={logoUrl ?? "/snakepic.png"}
          alt={display ? `${display} Logo` : "Company Logo"}
          className="w-full h-full object-cover rounded-xl ring-1 ring-black/5"
          onError={(e) => {
            e.currentTarget.src = "/snakepic.png";
          }}
        />
      </div>

      {/* Analytics */}
      <section className="w-full max-w-5xl">
        <h2 className="mb-4 text-xl font-semibold text-gray-800 text-center">
          Your Review Analytics
        </h2>
        <p className="mb-8 text-sm text-gray-600 text-center">
          A quick breakdown of your recent feedback.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <AnalyticsCard
            title="Good"
            count={counts?.good ?? 0}
            total={total}
            loading={loadingCounts}
            barClass="bg-green-500"
            badgeClass="bg-green-100 text-green-800 ring-green-200"
            onClick={() => router.push(`/${name}/dashboard/statistics`)}
          />
          <AnalyticsCard
            title="Bad"
            count={counts?.bad ?? 0}
            total={total}
            loading={loadingCounts}
            barClass="bg-red-500"
            badgeClass="bg-red-100 text-red-800 ring-red-200"
            onClick={() => router.push(`/${name}/dashboard/statistics`)}
          />
          <AnalyticsCard
            title="Unreviewed"
            count={counts?.not_reviewed_yet ?? 0}
            total={total}
            loading={loadingCounts}
            barClass="bg-gray-500"
            badgeClass="bg-gray-100 text-gray-800 ring-gray-200"
            onClick={() => router.push(`/${name}/dashboard/statistics`)}
          />
        </div>
      </section>

      {/* Recent Reviews */}
      <section className="mt-16 w-full max-w-5xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-800">Recent Reviews</h2>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={rvLoading || page === 0}
              className="rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              aria-label="Previous"
            >
              ←
            </button>
            <span className="text-sm text-gray-500">
              Page {Math.min(page + 1, totalPages)} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={rvLoading || page >= totalPages - 1}
              className="rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              aria-label="Next"
            >
              →
            </button>
          </div>
        </div>

        {rvLoading ? (
          <RecentReviewsSkeleton />
        ) : rvErr ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {rvErr}
          </div>
        ) : recent.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
            No recent reviews yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {visible.map((r) => (
              <RecentReviewCard key={r.client_id + r.updated_at} review={r} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------------- Small UI helpers ---------------- */

function AnalyticsCard({
  title,
  count,
  total,
  loading,
  barClass,
  badgeClass,
  onClick,
}: {
  title: string;
  count: number;
  total: number;
  loading: boolean;
  barClass: string;
  badgeClass: string;
  onClick?: () => void;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-800">{title}</div>
        <span className={`rounded-full px-2 py-1 text-xs font-medium ring-1 ${badgeClass}`}>
          {count} / {total}
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
        {loading ? (
          <div className="h-2 w-1/2 animate-pulse bg-gray-200" />
        ) : (
          <div
            className={`h-2 ${barClass}`}
            style={{ width: `${pct}%`, transition: "width 300ms ease" }}
          />
        )}
      </div>
      {!loading && <div className="mt-2 text-xs text-gray-500">{pct}%</div>}
    </button>
  );
}

function RecentReviewsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-gray-200 p-4">
          <div className="mb-2 h-4 w-2/3 rounded bg-gray-200" />
          <div className="mb-1 h-3 w-1/3 rounded bg-gray-200" />
          <div className="h-20 w-full rounded bg-gray-200" />
        </div>
      ))}
    </div>
  );
}

function SentimentChip({ v }: { v: string }) {
  const s = (v || "").toLowerCase();
  const styles =
    s === "good"
      ? "bg-green-100 text-green-800 ring-green-200"
      : s === "bad"
      ? "bg-red-100 text-red-800 ring-red-200"
      : "bg-gray-100 text-gray-700 ring-gray-200";
  const label = s === "good" ? "Good" : s === "bad" ? "Bad" : "Unreviewed";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${styles}`}>
      {label}
    </span>
  );
}

function RecentReviewCard({ review }: { review: RecentReview }) {
  const dateFmt = new Date(review.updated_at).toLocaleDateString();
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="truncate text-sm font-semibold text-gray-800" title={review.client_name}>
          {review.client_name}
        </div>
        <SentimentChip v={review.sentiment} />
      </div>
      <div className="mb-2 text-xs text-gray-500">{dateFmt}</div>
      <p
        className="text-sm text-gray-800"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 6,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          whiteSpace: "pre-wrap",
        }}
        title={review.review}
      >
        {review.review}
      </p>
    </div>
  );
}
