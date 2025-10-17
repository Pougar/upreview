// app/[username]/welcome/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { authClient } from "@/app/lib/auth-client";

type GetNameResp =
  | { success?: boolean; user?: { name?: string; display_name?: string } }
  | { name?: string; display_name?: string };

/* ===== Onboarding flow guard (kept for parity) ===== */
const NEXT_STEP_API = "/api/next-user-step";
const CURRENT_ACTION = "welcomed" as const;
const CURRENT_PAGE_SUFFIX = "/welcome";
/* ================================================ */

export default function WelcomePage() {
  const router = useRouter();
  const search = useSearchParams();
  const { data: session } = authClient.useSession();

  // Prefer userID from query, fallback to session
  const userIdFromQuery = search.get("UserID") ?? search.get("userID") ?? "";
  const userId = userIdFromQuery || session?.user?.id || "";

  // Local state for slug + display name
  const [slug, setSlug] = useState<string>("");
  const [display, setDisplay] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [going, setGoing] = useState(false);

  // Fetch name/display once (unchanged)
  const didCallRef = useRef(false);
  useEffect(() => {
    let alive = true;
    if (!userId || didCallRef.current) {
      setLoading(false);
      return;
    }
    didCallRef.current = true;

    (async () => {
      try {
        const res = await fetch("/api/get-name", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ id: userId }),
        });
        const data: GetNameResp = await res.json().catch(() => ({} as any));
        const n = (data as any)?.user?.name ?? (data as any)?.name ?? "";
        const d =
          (data as any)?.user?.display_name ??
          (data as any)?.display_name ??
          "";
        if (alive) {
          setSlug(n || "");
          setDisplay(d || "");
        }
      } catch {
        // minimal UI
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [userId]);

  // Click → record welcomed, then navigate (unchanged)
  async function handleGo(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (!slug || going) return;
    setGoing(true);
    try {
      await fetch("/api/user-welcomed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      }).catch(() => {});
    } finally {
      router.push(`/${slug}/dashboard`);
    }
  }

  const disabled = !slug || going;

  return (
    <div className="bg-white text-slate-900">
      <main className="mx-auto w-full max-w-3xl px-6 py-10 space-y-10">
        {/* Brand */}
        <div className="mb-1">
          <span className="rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
            upreview
          </span>
        </div>

        {/* Intro */}
        <section>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            {loading ? "Welcome…" : `Welcome${display ? `, ${display}` : ""}!`}
          </h1>
          <p className="mt-2 max-w-prose text-sm text-slate-600">
            Review Remind helps your business collect more positive Google reviews with less effort.
            Send friendly, timely follow-ups and track outcomes—so you can focus on great service while we
            help turn happy customers into public praise.
          </p>
        </section>

        {/* Automatic Emails */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Automatic follow-up emails</h2>
          <p className="text-sm text-slate-600 max-w-prose">
            Trigger a personalized follow-up that kindly asks for a Google review. Customize the message,
            include your link, and let the system handle delivery.
          </p>
          <MockEmailCard />
        </section>

        {/* Analytics */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Analytics you can act on</h2>
          <p className="text-sm text-slate-600 max-w-prose">
            Track sends, clicks, and reviews. Spot where to improve with simple, practical metrics.
          </p>
          <AnalyticsPreview />
        </section>

        {/* Xero integration */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Xero connection for automation</h2>
          <p className="text-sm text-slate-600 max-w-prose">
            Link Xero to import client contact details from invoices automatically. Keep your client list fresh—no manual entry.
          </p>
          <XeroPreview />
        </section>

        {/* Clients list */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Your clients list</h2>
          <p className="text-sm text-slate-600 max-w-prose">
            Quickly see who’s been emailed, who clicked, who submitted, and who might need a follow-up.
          </p>
          <ClientsPreview />
        </section>

        {/* CTA */}
        <section className="pt-2">
          <Link
            href={slug ? `/${slug}/dashboard` : "#"}
            onClick={handleGo}
            aria-disabled={disabled}
            className={`inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-semibold transition ${
              disabled
                ? "bg-blue-300 text-white cursor-not-allowed pointer-events-none"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {going ? "Opening…" : "Go to Dashboard"}
          </Link>
        </section>
      </main>
    </div>
  );
}

/* ------------------- Visual components (lightweight) ------------------- */

/* --- Mock Email (lighter, no heavy shadows) --- */
function MockEmailCard() {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-semibold text-slate-800">Preview: Client email</h3>

      <div className="mt-3 grid grid-cols-1 gap-1.5 text-sm text-slate-700">
        <Row label="From" value="Your Business &lt;team@yourbiz.com&gt;" />
        <Row label="To" value="customer@example.com" />
        <Row label="Subject" value="We’d love your feedback 💬" />
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-slate-800">Hi Customer,</p>
        <p className="mt-2 text-slate-800">
          Thanks again for choosing us! If you have a moment, would you mind sharing your experience on Google?
        </p>
        <div className="mt-4">
          <button
            type="button"
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Leave a Google Review
          </button>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          This is a sample preview. Actual emails include your logo and custom message.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium" dangerouslySetInnerHTML={{ __html: value }} />
    </div>
  );
}

/* --- Analytics (lean tiles + small donut) --- */
function AnalyticsPreview() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-800">Preview: Analytics snapshot</h3>

      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
        <StatTile label="Open rate" value="68%" sub="last 30 days" tone="good" />
        <StatTile label="Clicks" value="42%" sub="of opens" tone="good" />
        <StatTile label="Avg rating" value="4.6★" sub="reviews" tone="neutral" />
      </div>

      <div className="mt-5 flex items-center justify-center">
        <DonutChart
          segments={[
            { color: "#16a34a", value: 62, label: "Good" },
            { color: "#dc2626", value: 9, label: "Bad" },
            { color: "#6b7280", value: 29, label: "Unreviewed" },
          ]}
        />
      </div>
      <p className="mt-2 text-center text-[11px] text-slate-500">Example only.</p>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "neutral";
}) {
  const styles =
    tone === "good"
      ? "bg-emerald-50 text-emerald-900 ring-emerald-100"
      : tone === "bad"
      ? "bg-red-50 text-red-900 ring-red-100"
      : "bg-slate-50 text-slate-900 ring-slate-100";
  return (
    <div className={`rounded-lg ${styles} p-3 ring-1`}>
      <div className="text-[11px] opacity-70">{label}</div>
      <div className="mt-0.5 text-lg font-bold">{value}</div>
      {sub && <div className="text-[10px] opacity-60">{sub}</div>}
    </div>
  );
}

function DonutChart({
  segments,
}: {
  segments: { color: string; value: number; label: string }[];
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;
  const radius = 48;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label="Sentiment breakdown">
      <g transform="translate(75,75)">
        <circle r={radius} fill="none" stroke="#e5e7eb" strokeWidth="20" />
        {segments.map((s, i) => {
          const start = (acc / total) * circumference;
          const len = (s.value / total) * circumference;
          acc += s.value;
          return (
            <circle
              key={i}
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth="20"
              strokeDasharray={`${len} ${circumference - len}`}
              strokeDashoffset={-start}
            />
          );
        })}
      </g>
      <g transform="translate(8,132)" className="text-[10px]">
        {segments.map((s, i) => (
          <g key={i} transform={`translate(${i * 48},0)`}>
            <rect width="9" height="9" fill={s.color} rx="2" />
            <text x="12" y="8" fill="#374151" fontSize="10">
              {s.label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

/* --- Xero flow (subtle) --- */
function XeroPreview() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-800">Preview: Xero automation</h3>
      <ol className="mt-3 flex items-center justify-between gap-2">
        <FlowStep label="Link Xero" />
        <FlowArrow />
        <FlowStep label="Import contacts" />
        <FlowArrow />
        <FlowStep label="Auto-send requests" />
      </ol>
      <p className="mt-3 text-[11px] text-slate-500">
        Connect once; we keep your client list up to date automatically.
      </p>
    </div>
  );
}
function FlowStep({ label }: { label: string }) {
  return (
    <div className="flex min-w-[110px] flex-1 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-800">
      {label}
    </div>
  );
}
function FlowArrow() {
  return <div className="h-0 w-0 border-y-8 border-l-8 border-y-transparent border-l-slate-300" />;
}

/* --- Clients preview (lean table) --- */
function ClientsPreview() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-800">Preview: Clients list</h3>
      <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
        <div className="grid grid-cols-5 gap-4 border-b bg-slate-50 px-3 py-2 text-left text-[12px] font-semibold text-slate-700">
          <div>Name</div>
          <div>Email</div>
          <div>Phone</div>
          <div className="text-center">State</div>
          <div className="text-center">Action</div>
        </div>
        {[
          { n: "Alex Diaz", e: "alex@example.com", p: "0400 000 000", s: "Awaiting" },
          { n: "Priya Singh", e: "priya@example.com", p: "0400 111 111", s: "Clicked" },
          { n: "Sam Lee", e: "sam@example.com", p: "0400 222 222", s: "Submitted" },
        ].map((r, i) => (
          <div key={i} className="grid grid-cols-5 gap-4 px-3 py-2 text-sm">
            <div className="truncate">{r.n}</div>
            <div className="truncate text-slate-700">{r.e}</div>
            <div className="truncate text-slate-700">{r.p}</div>
            <div className="text-center">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ${
                  r.s === "Submitted"
                    ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                    : r.s === "Clicked"
                    ? "bg-amber-50 text-amber-800 ring-amber-200"
                    : "bg-slate-100 text-slate-700 ring-slate-200"
                }`}
              >
                {r.s}
              </span>
            </div>
            <div className="text-center">
              <span className="inline-flex items-center rounded-full bg-blue-600 px-2 py-0.5 text-xs font-medium text-white">
                Send email
              </span>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-slate-500">
        Visual preview only—your actual clients will appear on the Clients page.
      </p>
    </div>
  );
}
