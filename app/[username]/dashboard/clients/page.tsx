"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "../../UserContext";
import { useRouter } from "next/navigation";
import SendEmailButton from "@/app/ui/clients/send-email-button";
import { authClient } from "@/app/lib/auth-client";

type Client = {
  id: string;
  name: string;
  email: string | null;
  phone_number: string | null;
  sentiment: "good" | "bad" | "unreviewed" | string;
  review: string | null;
  email_sent: boolean | null;
  review_clicked: boolean | null;
  review_submitted: boolean | null;
};

const CLIENTS_API = "/api/get-clients"; // server reads user from session
const SYNC_FROM_XERO_API = "/api/xero/get-clients-from-xero";

export default function ClientsPage() {
  const { name: username, display } = useUser();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? null;

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [syncErr, setSyncErr] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [selected, setSelected] = useState<Client | null>(null);
  const router = useRouter();

  // --- NEW: dropdown date inputs ---
  const [dateOpen, setDateOpen] = useState(false);
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setDateOpen(false);
    }
    if (dateOpen) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [dateOpen]);

  const formattedSince = useMemo(() => {
    if (!year && !month && !day) return null;
    const y = year.padStart(4, "0");
    const m = month.padStart(2, "0");
    const d = day.padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, [year, month, day]);

  const dateValid = useMemo(() => {
    if (!year || !month || !day) return false;
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    if (!Number.isInteger(y) || y < 1900 || y > 2100) return false;
    if (!Number.isInteger(m) || m < 1 || m > 12) return false;
    const maxDay = new Date(y, m, 0).getDate();
    if (!Number.isInteger(d) || d < 1 || d > maxDay) return false;
    return true;
  }, [year, month, day]);

  // Load clients (server resolves user from session)
  const refreshClients = useCallback(async () => {
    try {
      const res = await fetch(CLIENTS_API, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to load clients (${res.status}) ${text}`);
      }
      const data = (await res.json()) as { clients?: Client[] } | Client[];
      const list = Array.isArray(data) ? data : data.clients ?? [];
      setClients(list);
    } catch (e: any) {
      setErr(e.message || "Failed to load clients");
    }
  }, []);

  // Import from Xero then refresh — body includes userId (+ optional since)
  const syncFromXero = useCallback(
    async (since?: string | null) => {
      if (!userId) return; // guard until session available
      setSyncErr(null);
      setSyncing(true);
      try {
        const body: Record<string, any> = { userId };
        if (since && since.trim()) body.since = since.trim();

        const res = await fetch(SYNC_FROM_XERO_API, {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Sync failed (${res.status}) ${text}`);
        }
        await refreshClients();
        setDateOpen(false);
      } catch (e: any) {
        setSyncErr(e.message || "Failed to import from Xero");
      } finally {
        setSyncing(false);
      }
    },
    [userId, refreshClients]
  );

  // Initial load once we have a session (cookies present)
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        await refreshClients();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshClients]);

  const empty = !loading && !err && clients.length === 0;

  return (
    <div className="min-h-screen w-full">
      <div className="mx-auto max-w-6xl">
        {/* Header with top-right Import button + dropdown */}
        <header className="mb-6 flex items-start justify-between gap-4 relative z-30">
        <div>
            <h1 className="text-2xl font-bold text-gray-800">Your Clients</h1>
            <p className="text-sm text-gray-600">Click row to read review</p>
        </div>

        {/* RIGHT SIDE: stack vertically so the date panel appears BELOW the button */}
        <div ref={menuRef} className="flex flex-col items-end gap-2">
            {/* Top row: signed-in text + button */}
            <div className="flex items-center gap-3">
            <p className="text-sm text-gray-500">
                Signed in as <span className="font-semibold">{display}</span>
            </p>

            <button
                onClick={() => setDateOpen((v) => !v)}
                disabled={!userId}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-60"
                aria-expanded={dateOpen}
                aria-controls="xero-date-panel"
            >
                {syncing ? (
                <>
                    <Spinner className="h-4 w-4" />
                    Importing…
                </>
                ) : !userId ? (
                <>
                    <Spinner className="h-4 w-4" />
                    Preparing…
                </>
                ) : (
                <>Import from Xero</>
                )}
            </button>
            </div>

            {/* Bottom row: the date inputs panel (now statically positioned below the button) */}
            {dateOpen && (
            <div
                id="xero-date-panel"
                role="dialog"
                aria-label="Choose date to import clients after"
                className="absolute right-0 top-12 z-50 w-[320px] rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
                onKeyDown={(e) => {
                if (e.key === "Escape") setDateOpen(false);
                }}
            >
                <div className="mb-2 text-sm font-semibold text-gray-800">
                Clients after
                </div>

                <div className="mb-2 grid grid-cols-3 gap-2">
                <input
                    inputMode="numeric"
                    pattern="\d*"
                    maxLength={4}
                    placeholder="YYYY"
                    value={year}
                    onChange={(e) =>
                    setYear(e.target.value.replace(/\D/g, "").slice(0, 4))
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                    aria-label="Year (YYYY)"
                />
                <input
                    inputMode="numeric"
                    pattern="\d*"
                    maxLength={2}
                    placeholder="MM"
                    value={month}
                    onChange={(e) =>
                    setMonth(e.target.value.replace(/\D/g, "").slice(0, 2))
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                    aria-label="Month (MM)"
                />
                <input
                    inputMode="numeric"
                    pattern="\d*"
                    maxLength={2}
                    placeholder="DD"
                    value={day}
                    onChange={(e) =>
                    setDay(e.target.value.replace(/\D/g, "").slice(0, 2))
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                    aria-label="Day (DD)"
                    onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        if (dateValid) syncFromXero(formattedSince);
                    }
                    }}
                />
                </div>

                <div className="mb-3 text-xs text-gray-500">
                Example: <code>2025</code> / <code>06</code> / <code>01</code>
                </div>
                {!dateValid && (year || month || day) && (
                <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                    Please enter a valid date.
                </div>
                )}

                <div className="flex items-center justify-end gap-2">
                <button
                    type="button"
                    className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                    onClick={() => {
                    setYear("");
                    setMonth("");
                    setDay("");
                    setDateOpen(false);
                    }}
                >
                    Cancel
                </button>
                <button
                    type="button"
                    disabled={syncing || (year || month || day ? !dateValid : false)}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:opacity-60"
                    onClick={() => {
                    const since =
                        year || month || day ? (dateValid ? formattedSince : null) : null;
                    syncFromXero(since ?? undefined);
                    }}
                >
                    {syncing ? "Importing…" : "Import"}
                </button>
                </div>
            </div>
            )}
        </div>
        </header>

        {syncErr && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {syncErr}
          </div>
        )}

        <div className="relative z-0 rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-x-auto">
          {/* header row (5 columns now) */}
          <div className="grid grid-cols-5 gap-4 border-b px-4 py-3 text-left text-sm font-semibold text-gray-700">
            <div>Name</div>
            <div>Email</div>
            <div>Phone</div>
            <div className="text-center">State</div>
            <div className="text-center">Action</div>
          </div>

          {/* body */}
          {loading ? (
            <SkeletonRows />
          ) : err ? (
            <div className="p-6 text-sm text-red-600">{err}</div>
          ) : empty ? (
            <div className="p-6 text-sm text-gray-500">
              No clients yet. Once you add clients, they’ll appear here.
            </div>
          ) : (
            <ul className="divide-y">
              {clients.map((c) => (
                <li
                  key={c.id}
                  className="grid grid-cols-5 gap-4 px-4 py-3 text-sm transition hover:bg-sky-50 cursor-pointer focus:outline-none focus:bg-sky-100"
                  onClick={() => setSelected(c)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(c);
                    }
                  }}
                >
                  <div className="truncate font-medium text-gray-800">
                    {c.name}
                  </div>
                  <div className="truncate text-gray-700">{c.email || "—"}</div>
                  <div className="truncate text-gray-700">
                    {c.phone_number || "—"}
                  </div>

                  {/* Single State column */}
                  <div className="justify-self-center self-center">
                    <StateBadge
                      clicked={!!c.review_clicked}
                      submitted={!!c.review_submitted}
                      sentiment={(c.sentiment || "").toLowerCase()}
                    />
                  </div>

                  {/* Action cell — stop the row click here */}
                  <div
                    className="flex items-center justify-center"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <SendEmailButton
                      clientId={c.id}
                      disabled={!!c.email_sent}
                      onSent={refreshClients}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Add Client button */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={() =>
              router.push(`/${username}/dashboard/clients/add-client`)
            }
            className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            aria-label="Add Client"
          >
            Add Client
          </button>
        </div>
      </div>

      {selected && (
        <Modal
          onClose={() => setSelected(null)}
          title={`Review from ${selected.name}`}
        >
          <ReviewContent
            sentiment={selected.sentiment}
            review={selected.review}
          />
        </Modal>
      )}
    </div>
  );
}

/* ---------- UI pieces ---------- */

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

function SkeletonRows() {
  return (
    <div className="animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="grid grid-cols-5 gap-4 px-4 py-3">
          <div className="h-4 w-40 rounded bg-gray-200" />
          <div className="h-4 w-56 rounded bg-gray-200" />
          <div className="h-4 w-32 rounded bg-gray-200" />
          <div className="h-6 w-36 rounded bg-gray-200 justify-self-center" />
          <div className="h-6 w-24 rounded bg-gray-200 justify-self-center" />
        </div>
      ))}
    </div>
  );
}

function StateBadge({
  clicked,
  submitted,
  sentiment,
}: {
  clicked: boolean;
  submitted: boolean;
  sentiment: string | null | undefined;
}) {
  let label = "Awaiting Response";
  let styles = "bg-gray-100 text-gray-700 ring-gray-200";

  if (clicked && !submitted) {
    label = "Review Clicked";
    styles = "bg-amber-100 text-amber-800 ring-amber-200";
  } else if (clicked && submitted) {
    label = "Review Submitted";
    const s = (sentiment || "").toLowerCase();
    if (s === "good") styles = "bg-green-100 text-green-800 ring-green-200";
    else if (s === "bad") styles = "bg-red-100 text-red-800 ring-red-200";
    else styles = "bg-gray-100 text-gray-700 ring-gray-200";
  }

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-medium ring-1 ${styles}`}
    >
      {label}
    </span>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="text-sm text-gray-800">{children}</div>
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewContent({
  sentiment,
  review,
}: {
  sentiment: string;
  review: string | null;
}) {
  const hint = useMemo(() => {
    const v = sentiment?.toLowerCase();
    if (v === "good") return "This client left a positive sentiment.";
    if (v === "bad") return "This client left a negative sentiment.";
    return "This client hasn’t been reviewed yet.";
  }, [sentiment]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500">Sentiment:</span>
        <span className="inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-medium ring-1 bg-gray-100 text-gray-700 ring-gray-200">
          {hint}
        </span>
      </div>
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-gray-800">
        {review?.trim() ? (
          <p className="whitespace-pre-wrap leading-relaxed">{review}</p>
        ) : (
          <p className="text-gray-500">No review text provided.</p>
        )}
      </div>
    </div>
  );
}
