// app/[username]/welcome/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { authClient } from "@/app/lib/auth-client";

type GetNameResp =
  | { success?: boolean; user?: { name?: string; display_name?: string } }
  | { name?: string; display_name?: string };

export default function WelcomePage() {
  const router = useRouter();
  const search = useSearchParams();
  const { data: session } = authClient.useSession();

  // Prefer userID from query, fallback to session
  const userIdFromQuery = search.get("userID") ?? "";
  const userId = userIdFromQuery || session?.user?.id || "";

  // Local state for slug + display name
  const [slug, setSlug] = useState<string>("");
  const [display, setDisplay] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [going, setGoing] = useState(false);

  // Fetch name/display once (LOGIC UNCHANGED)
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

  // Click → record welcomed, then navigate (LOGIC UNCHANGED)
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
    <div className="min-h-screen overflow-y-auto bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      {/* Sticky stepper */}
      <div className="sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-white/50 bg-white/70 border-b border-white/60">
        <div className="mx-auto max-w-5xl px-6 py-3">
          <Stepper current={3} labels={["Set up account", "Link services", "Review overview"]} />
          <p className="mt-1 text-xs font-medium text-gray-700 text-center">
            Step 3 of 3 — welcome{display ? `, ${display}` : ""}! 🎉
          </p>
        </div>
      </div>

      {/* Vertical scroller content */}
      <main className="mx-auto max-w-5xl px-6 py-8 space-y-10">
        {/* Intro (soft, minimal) */}
        <section className="px-2">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            {loading ? "Welcome…" : `Welcome${display ? `, ${display}` : ""}!`}
          </h1>
          <p className="mt-3 max-w-3xl text-gray-700 leading-relaxed">
            Review Remind helps your business collect more positive Google reviews with less effort.
            Send friendly, timely follow-ups to your clients and track the outcomes—so you can focus
            on great service while we help turn happy customers into public praise.
          </p>
        </section>

        {/* Automatic Emails */}
        <section className="space-y-4">
          <div className="px-2">
            <h2 className="text-xl font-semibold text-gray-900">Automatic follow-up emails</h2>
            <p className="mt-2 text-gray-700 max-w-3xl">
              After you complete a job, trigger a personalized follow-up that kindly asks for a Google review.
              Customize the message, include your review link, and let the system handle timing and delivery.
            </p>
            <ul className="mt-3 list-inside list-disc text-sm text-gray-600 max-w-3xl">
              <li>Personalized greeting with your business name</li>
              <li>Clear call-to-action linking to your Google review page</li>
              <li>Optional reminders for non-responders</li>
            </ul>
          </div>
          {/* ⬇ revert to earlier card-style visual */}
          <MockEmailCard />
        </section>

        {/* Analytics */}
        <section className="space-y-4">
          <div className="px-2">
            <h2 className="text-xl font-semibold text-gray-900">Analytics you can act on</h2>
            <p className="mt-2 text-gray-700 max-w-3xl">
              Track performance and spot where to improve. We surface practical metrics:
              open/click rates, sentiment breakdown, time to review, and follow-up effectiveness.
            </p>
          </div>
          {/* ⬇ revert to earlier card-style visual */}
          <AnalyticsPreview />
        </section>

        {/* Xero integration */}
        <section className="space-y-4">
          <div className="px-2">
            <h2 className="text-xl font-semibold text-gray-900">Xero connection for automation</h2>
            <p className="mt-2 text-gray-700 max-w-3xl">
              Link your Xero account to automatically import client contact details after you raise invoices.
              This keeps your client list fresh and saves manual data entry.
            </p>
            <ul className="mt-3 list-inside list-disc text-sm text-gray-600">
              <li>Sync contacts from invoices to your client list</li>
              <li>De-duplicate existing contacts intelligently</li>
              <li>Optional scheduling to send requests soon after payment</li>
            </ul>
          </div>
          {/* ⬇ revert to earlier card-style visual */}
          <XeroPreview />
        </section>

        {/* Clients list */}
        <section className="space-y-4">
          <div className="px-2">
            <h2 className="text-xl font-semibold text-gray-900">Your clients list</h2>
            <p className="mt-2 text-gray-700 max-w-3xl">
              A single place to view clients, contact details, and review status. Quickly check who’s
              been emailed, who clicked, who submitted, and who might need a follow-up.
            </p>
          </div>
          {/* ⬇ revert to earlier card-style visual */}
          <ClientsPreview />
        </section>

        {/* CTA */}
        <section className="pb-10">
          <div className="flex items-center justify-center">
            <Link
              href={slug ? `/${slug}/dashboard` : "#"}
              onClick={handleGo}
              aria-disabled={disabled}
              className={`inline-flex items-center justify-center rounded-full px-6 py-3 font-semibold shadow focus:outline-none focus:ring-2 transition ${
                disabled
                  ? "bg-gray-200 text-gray-500 cursor-not-allowed pointer-events-none"
                  : "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-400"
              }`}
            >
              {going ? "Opening…" : "Go to Dashboard"}
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

/* ------------------- Visual components (stronger “card” style) ------------------- */

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

/* --- Mock Email --- */
function MockEmailCard() {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5">
      <h3 className="text-sm font-semibold text-gray-800">Preview: Client email</h3>
      <div className="mt-3 space-y-2 text-sm text-gray-700">
        <div className="flex justify-between">
          <span className="text-gray-500">From</span>
          <span className="font-medium">Your Business &lt;team@yourbiz.com&gt;</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">To</span>
          <span className="font-medium">customer@example.com</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Subject</span>
          <span className="font-medium">We’d love your feedback 💬</span>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-gray-800">
          Hi <span className="font-medium">Customer</span>, thanks again for choosing us!
          If you have a moment, would you mind sharing your experience on Google?
        </p>
        <div className="mt-4">
          <button
            type="button"
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
          >
            Leave a Google Review
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          This is a sample preview. Actual emails include your logo and custom message.
        </p>
      </div>
    </div>
  );
}

/* --- Analytics --- */
function AnalyticsPreview() {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5">
      <h3 className="text-sm font-semibold text-gray-800">Preview: Analytics snapshot</h3>

      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
        <StatTile label="Open rate" value="68%" sub="last 30 days" tone="good" />
        <StatTile label="Clicks" value="42%" sub="of opens" tone="good" />
        <StatTile label="Avg rating" value="4.6★" sub="submitted reviews" tone="neutral" />
      </div>

      <div className="mt-6 flex items-center justify-center">
        <DonutChart
          segments={[
            { color: "#16a34a", value: 62, label: "Good" },
            { color: "#dc2626", value: 9, label: "Bad" },
            { color: "#6b7280", value: 29, label: "Unreviewed" },
          ]}
        />
      </div>
      <p className="mt-2 text-center text-xs text-gray-500">
        Example distribution (for demonstration only).
      </p>
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
      : "bg-gray-50 text-gray-900 ring-gray-100";
  return (
    <div className={`rounded-xl ${styles} p-4 ring-1`}>
      <div className="text-xs opacity-70">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
      {sub && <div className="text-[11px] opacity-60">{sub}</div>}
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
  const radius = 60;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg width="180" height="180" viewBox="0 0 180 180" role="img" aria-label="Sentiment breakdown">
      <g transform="translate(90,90)">
        <circle r={radius} fill="none" stroke="#e5e7eb" strokeWidth="22" />
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
              strokeWidth="22"
              strokeDasharray={`${len} ${circumference - len}`}
              strokeDashoffset={-start}
              strokeLinecap="butt"
            />
          );
        })}
      </g>
      <g transform="translate(10,150)" className="text-xs">
        {segments.map((s, i) => (
          <g key={i} transform={`translate(${i * 54},0)`}>
            <rect width="10" height="10" fill={s.color} rx="2" />
            <text x="14" y="9" fill="#374151" fontSize="10">
              {s.label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

/* --- Xero flow --- */
function XeroPreview() {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5">
      <h3 className="text-sm font-semibold text-gray-800">Preview: Xero automation</h3>
      <ol className="mt-3 flex items-center justify-between gap-2">
        <FlowStep label="Link Xero" />
        <FlowArrow />
        <FlowStep label="Import contacts" />
        <FlowArrow />
        <FlowStep label="Auto-send requests" />
      </ol>
      <p className="mt-3 text-xs text-gray-500">
        Connect once; we keep your client list up to date automatically.
      </p>
    </div>
  );
}
function FlowStep({ label }: { label: string }) {
  return (
    <div className="flex min-w-[120px] flex-1 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-800">
      {label}
    </div>
  );
}
function FlowArrow() {
  return <div className="h-0 w-0 border-y-8 border-l-8 border-y-transparent border-l-gray-300" />;
}

/* --- Clients preview --- */
function ClientsPreview() {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5">
      <h3 className="text-sm font-semibold text-gray-800">Preview: Clients list</h3>
      <div className="mt-3 overflow-hidden rounded-xl border border-gray-200">
        <div className="grid grid-cols-5 gap-4 border-b bg-gray-50 px-4 py-2 text-left text-xs font-semibold text-gray-700">
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
          <div key={i} className="grid grid-cols-5 gap-4 px-4 py-2 text-sm">
            <div className="truncate">{r.n}</div>
            <div className="truncate text-gray-700">{r.e}</div>
            <div className="truncate text-gray-700">{r.p}</div>
            <div className="text-center">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ${
                  r.s === "Submitted"
                    ? "bg-green-100 text-green-800 ring-green-200"
                    : r.s === "Clicked"
                    ? "bg-amber-100 text-amber-800 ring-amber-200"
                    : "bg-gray-100 text-gray-700 ring-gray-200"
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
      <p className="mt-3 text-xs text-gray-500">
        This is a visual preview only—your actual clients will appear on the Clients page.
      </p>
    </div>
  );
}
