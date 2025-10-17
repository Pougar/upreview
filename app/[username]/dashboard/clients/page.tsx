// app/[username]/dashboard/clients/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "../../UserContext";
import { useRouter } from "next/navigation";
import { authClient } from "@/app/lib/auth-client";

/*
  This version
  - Keeps bulk select + bulk send, Xero import, Google sync
  - Shows a single Status column:
      • Review submitted (always priority if present)
      • else the most recent of Button clicked / Last email sent
      • else No email sent
  - Keeps "Added" and "Invoice Status" columns
  - Sorting left as previously: never emailed first, then by oldest last_email_sent_at → newest
*/

type Client = {
  id: string;
  name: string;
  email: string | null;
  phone_number: string | null;
  sentiment: "good" | "bad" | "unreviewed" | string;
  review: string | null;

  // legacy flags (still returned by API; not used for Status priority logic)
  email_sent: boolean | null;
  review_clicked: boolean | null;
  review_submitted: boolean | null;

  // timeline data from API
  added_at: string;                 // ISO
  email_last_sent_at: string | null; // ISO or null
  click_at: string | null;           // ISO or null
  review_submitted_at: string | null; // ISO or null

  invoice_status: "PAID" | "SENT" | "DRAFT" | "PAID BUT NOT SENT" | null;
};

const CLIENTS_API = "/api/clients/get-clients";
const SYNC_FROM_XERO_API = "/api/xero/get-clients-from-xero";
const SYNC_GOOGLE_REVIEWS_API = "/api/clients/sync-with-google-reviews";
const SEND_BULK_EMAILS_API = "/api/send-bulk-emails";

export default function ClientsPage() {
  const { name: username, display } = useUser();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? null;

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [syncErr, setSyncErr] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [gSyncErr, setGSyncErr] = useState<string | null>(null);
  const [gSyncing, setGSyncing] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkErr, setBulkErr] = useState<string | null>(null);

  const [selected, setSelected] = useState<Client | null>(null);
  const router = useRouter();

  // Xero date dropdown
  const [dateOpen, setDateOpen] = useState(false);
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);

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
    const y = Number(year), m = Number(month), d = Number(day);
    if (!Number.isInteger(y) || y < 1900 || y > 2100) return false;
    if (!Number.isInteger(m) || m < 1 || m > 12) return false;
    const maxDay = new Date(y, m, 0).getDate();
    if (!Number.isInteger(d) || d < 1 || d > maxDay) return false;
    return true;
  }, [year, month, day]);

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

  // Import from Xero then refresh
  const syncFromXero = useCallback(async (since?: string | null) => {
    if (!userId) return;
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
  }, [userId, refreshClients]);

  // Sync with Google Reviews then refresh
  const syncWithGoogleReviews = useCallback(async () => {
    if (!userId) return;
    setGSyncErr(null);
    setGSyncing(true);
    try {
      const res = await fetch(SYNC_GOOGLE_REVIEWS_API, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Google sync failed (${res.status}) ${text}`);
      }
      await refreshClients();
    } catch (e: any) {
      setGSyncErr(e.message || "Failed to sync with Google reviews");
    } finally {
      setGSyncing(false);
    }
  }, [userId, refreshClients]);

  // Bulk send emails
  const toggleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const allSelected = useMemo(
    () => selectedIds.size > 0 && selectedIds.size === clients.length,
    [selectedIds, clients.length]
  );

  const toggleSelectAll = useCallback((checked: boolean) => {
    setSelectedIds(() => checked ? new Set(clients.map(c => c.id)) : new Set());
  }, [clients]);

  const sendBulkEmails = useCallback(async () => {
    if (!userId || selectedIds.size === 0) return;
    setBulkErr(null);
    setBulkSending(true);
    try {
      const res = await fetch(SEND_BULK_EMAILS_API, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, clientIds: Array.from(selectedIds) }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Bulk send failed (${res.status}) ${text}`);
      }
      setSelectedIds(new Set());
      await refreshClients();
    } catch (e: any) {
      setBulkErr(e.message || "Failed to send emails to selected clients");
    } finally {
      setBulkSending(false);
    }
  }, [userId, selectedIds, refreshClients]);

  // Initial load
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
    return () => { alive = false; };
  }, [refreshClients]);

  // Helpers
  const formatDateOnly = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

  // Sorting: Never emailed first (email_last_sent_at == null), then by oldest last email → newest.
  // Among "never emailed", tie-break by added_at oldest → newest.
  const sortedClients = useMemo(() => {
    const copy = [...clients];
    copy.sort((a, b) => {
      const aSent = a.email_last_sent_at ? 1 : 0;
      const bSent = b.email_last_sent_at ? 1 : 0;
      if (aSent !== bSent) return aSent - bSent; // never first

      if (!a.email_last_sent_at && !b.email_last_sent_at) {
        return new Date(a.added_at).getTime() - new Date(b.added_at).getTime();
      }
      return new Date(a.email_last_sent_at || 0).getTime() - new Date(b.email_last_sent_at || 0).getTime();
    });
    return copy;
  }, [clients]);

  const empty = !loading && !err && sortedClients.length === 0;

  return (
    <div className="min-h-screen w-full">
      <div className="mx-auto max-w-6xl">
        {/* Header with actions */}
        <header className="mb-4 flex items-start justify-between gap-4 relative z-30">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Your Clients</h1>
            <p className="text-sm text-gray-600">Click a row to read the review</p>
          </div>

          {/* Actions area */}
          <div className="flex flex-col items-end gap-2" ref={menuRef}>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-gray-500">
                Signed in as <span className="font-semibold">{display}</span>
              </p>

              {/* Sync with Google Reviews */}
              <button
                onClick={syncWithGoogleReviews}
                disabled={!userId || gSyncing}
                className="inline-flex items-center gap-2 rounded-full bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-60"
              >
                {gSyncing ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    Syncing Google…
                  </>
                ) : (
                  <>Sync with Google Reviews</>
                )}
              </button>

              {/* Import from Xero */}
              <button
                onClick={() => setDateOpen(v => !v)}
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

            {/* Xero Date Panel */}
            {dateOpen && (
              <div
                id="xero-date-panel"
                role="dialog"
                aria-label="Choose date to import clients after"
                className="absolute right-0 top-12 z-50 w-[320px] rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
                onKeyDown={(e) => e.key === "Escape" && setDateOpen(false)}
              >
                <div className="mb-2 text-sm font-semibold text-gray-800">Clients after</div>

                <div className="mb-2 grid grid-cols-3 gap-2">
                  <NumericInput label="Year (YYYY)" value={year} onChange={setYear} maxLength={4} placeholder="YYYY" focusColor="emerald" />
                  <NumericInput label="Month (MM)" value={month} onChange={setMonth} maxLength={2} placeholder="MM" focusColor="emerald" />
                  <NumericInput label="Day (DD)" value={day} onChange={setDay} maxLength={2} placeholder="DD" focusColor="emerald" onEnter={() => dateValid && syncFromXero(formattedSince)} />
                </div>

                <div className="mb-3 text-xs text-gray-500">
                  Example: <code>2025</code> / <code>06</code> / <code>01</code>
                </div>
                {!dateValid && (year || month || day) && (
                  <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">Please enter a valid date.</div>
                )}

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                    onClick={() => { setYear(""); setMonth(""); setDay(""); setDateOpen(false); }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={syncing || (year || month || day ? !dateValid : false)}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:opacity-60"
                    onClick={() => {
                      const since = year || month || day ? (dateValid ? formattedSince : null) : null;
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

        {/* Bulk toolbar */}
        <div className="mb-4 flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-sm text-gray-600">
            {selectedIds.size === 0 ? "No clients selected." : <><span className="font-medium">{selectedIds.size}</span> selected.</>}
          </div>
          <div className="flex items-center gap-2">
            {bulkErr && <div className="text-sm text-red-600">{bulkErr}</div>}
            <button
              onClick={sendBulkEmails}
              disabled={!userId || selectedIds.size === 0 || bulkSending}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 ${
                selectedIds.size === 0
                  ? "bg-gray-100 text-gray-400 ring-gray-200 cursor-not-allowed"
                  : "bg-blue-600 text-white ring-blue-300 hover:bg-blue-700"
              }`}
            >
              {bulkSending ? (<><Spinner className="h-4 w-4" /> Sending emails…</>) : "Send email to selected clients"}
            </button>
          </div>
        </div>

        {/* Error banners */}
        {syncErr && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{syncErr}</div>}
        {gSyncErr && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{gSyncErr}</div>}

        <div className="relative z-0 rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-x-auto">
          {/* header row (6 columns) */}
          <div className="grid grid-cols-6 gap-4 border-b px-4 py-3 text-left text-sm font-semibold text-gray-700">
            <div className="flex items-center gap-2">
              <ClickTargetCheckbox
                checked={allSelected}
                onChange={(checked) => toggleSelectAll(checked)}
                ariaLabel="Select all clients"
              />

              <span>Name</span>
            </div>
            <div>Email</div>
            <div>Phone</div>
            <div>Added</div>
            <div className="text-center">Invoice Status</div>
            <div className="text-center">Status</div>
          </div>

          {/* body */}
          {loading ? (
            <SkeletonRows cols={6} />
          ) : err ? (
            <div className="p-6 text-sm text-red-600">{err}</div>
          ) : empty ? (
            <div className="p-6 text-sm text-gray-500">No clients yet. Once you add clients, they’ll appear here.</div>
          ) : (
            <ul className="divide-y">
              {sortedClients.map((c) => {
                const rowChecked = selectedIds.has(c.id);
                return (
                  <li
                    key={c.id}
                    className={`grid grid-cols-6 gap-4 px-4 py-3 text-sm transition cursor-pointer hover:bg-gray-50 focus:outline-none ${rowChecked ? "bg-blue-50/40" : ""}`}
                    onClick={() => setSelected(c)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(c); }
                    }}
                  >
                    {/* Name + checkbox */}
                    <div className="truncate font-medium text-gray-800 flex items-center gap-2">
                      <ClickTargetCheckbox
                        checked={rowChecked}
                        onChange={(checked) => toggleSelect(c.id, checked)}
                        ariaLabel={`Select ${c.name}`}
                        stopRowClick
                      />

                      <span className="truncate">{c.name}</span>
                    </div>

                    <div className="truncate text-gray-700">{c.email || "—"}</div>
                    <div className="truncate text-gray-700">{c.phone_number || "—"}</div>
                    <div className="text-gray-700">{formatDateOnly(c.added_at)}</div>

                    {/* Invoice Status */}
                    <div className="justify-self-center self-center">
                      <InvoiceStatusBadge status={c.invoice_status} />
                    </div>

                    {/* Single Status cell */}
                    <div className="justify-self-center self-center">
                      <StatusCell
                        emailLastSentAt={c.email_last_sent_at}
                        clickAt={c.click_at}
                        submittedAt={c.review_submitted_at}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Add Client button */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={() => router.push(`/${username}/dashboard/clients/add-client`)}
            className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            aria-label="Add Client"
          >
            Add Client
          </button>
        </div>
      </div>

      {selected && (
        <Modal onClose={() => setSelected(null)} title={`Review from ${selected.name}`}>
          <ReviewContent sentiment={selected.sentiment} review={selected.review} />
        </Modal>
      )}
    </div>
  );
}

/* ---------- UI pieces ---------- */
function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function NumericInput({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
  focusColor = "emerald",
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength: number;
  placeholder: string;
  focusColor?: "emerald" | "blue" | "sky";
  onEnter?: () => void;
}) {
  return (
    <input
      inputMode="numeric"
      pattern="\\d*"
      maxLength={maxLength}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, maxLength))}
      className={`w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-${focusColor}-500`}
      aria-label={label}
      onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
    />
  );
}

function SkeletonRows({ cols = 6 }: { cols?: number }) {
  return (
    <div className="animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className={`grid grid-cols-${cols} gap-4 px-4 py-3`}>
          <div className="h-4 w-40 rounded bg-gray-200" />
          <div className="h-4 w-56 rounded bg-gray-200" />
          <div className="h-4 w-32 rounded bg-gray-200" />
          <div className="h-4 w-24 rounded bg-gray-200" />
          <div className="h-6 w-36 rounded bg-gray-200 justify-self-center" />
          <div className="h-6 w-40 rounded bg-gray-200 justify-self-center" />
        </div>
      ))}
    </div>
  );
}

function InvoiceStatusBadge({ status }: { status: Client["invoice_status"] }) {
  let label = status ?? "—";
  let styles = "bg-gray-100 text-gray-700 ring-gray-200";

  switch (status) {
    case "PAID":
      styles = "bg-green-100 text-green-800 ring-green-200";
      break;
    case "SENT":
      styles = "bg-sky-100 text-sky-800 ring-sky-200";
      break;
    case "DRAFT":
      styles = "bg-gray-100 text-gray-700 ring-gray-200";
      break;
    case "PAID BUT NOT SENT":
      styles = "bg-green-100 text-green-800 ring-green-200";
      break;
    default:
      label = "—";
      styles = "bg-gray-100 text-gray-700 ring-gray-200";
  }

  return (
    <span className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-medium ring-1 ${styles}`}>
      {label}
    </span>
  );
}

/** Single status cell with priority:
 * 1) If submittedAt exists → "Review submitted" (green)
 * 2) Else choose the most recent between clickAt and emailLastSentAt:
 *      • if clickAt is most recent → "Button clicked" (amber)
 *      • else if emailLastSentAt → "Last email sent" (blue)
 * 3) Else → "No email sent" (gray)
 */
function StatusCell({
  emailLastSentAt,
  clickAt,
  submittedAt,
}: {
  emailLastSentAt: string | null;
  clickAt: string | null;
  submittedAt: string | null;
}) {
  let label = "No email sent";
  let when: string | null = null;
  let styles = "bg-gray-100 text-gray-700 ring-gray-200";

  if (submittedAt) {
    label = "Review submitted";
    when = new Date(submittedAt).toLocaleString();
    styles = "bg-green-50 text-green-800 ring-green-200";
  } else {
    const clickTime = clickAt ? new Date(clickAt).getTime() : null;
    const emailTime = emailLastSentAt ? new Date(emailLastSentAt).getTime() : null;

    if (clickTime !== null || emailTime !== null) {
      const mostRecent =
        clickTime !== null && emailTime !== null
          ? Math.max(clickTime, emailTime)
          : (clickTime ?? emailTime)!;

      if (clickTime !== null && mostRecent === clickTime) {
        label = "Button clicked";
        when = new Date(clickTime).toLocaleString();
        styles = "bg-amber-50 text-amber-800 ring-amber-200";
      } else if (emailTime !== null) {
        label = "Last email sent";
        when = new Date(emailTime).toLocaleString();
        styles = "bg-blue-50 text-blue-800 ring-blue-200";
      }
    }
  }

  return (
    <div className="flex flex-col items-center">
      <span className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-medium ring-1 ${styles}`}>
        {label}
      </span>
      <span className="mt-1 text-[11px] text-gray-500">{when ?? "—"}</span>
    </div>
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

function ClickTargetCheckbox({
  checked,
  onChange,
  ariaLabel,
  stopRowClick = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
  /** true for row checkboxes so clicks don't bubble to the row */
  stopRowClick?: boolean;
}) {
  return (
    <label
      className="-m-2 inline-flex items-center p-2 rounded-md select-none"
      onClick={stopRowClick ? (e) => e.stopPropagation() : undefined}
      onMouseDown={stopRowClick ? (e) => e.stopPropagation() : undefined}
    >
      <input
        type="checkbox"
        aria-label={ariaLabel}
        // Accent stays subtle; focus ring only on keyboard (focus-visible) and gray, not blue
        className="h-4 w-4 rounded border-gray-300 text-blue-600"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        onClick={stopRowClick ? (e) => e.stopPropagation() : undefined}
        onMouseDown={stopRowClick ? (e) => e.stopPropagation() : undefined}
      />
    </label>
  );
}
