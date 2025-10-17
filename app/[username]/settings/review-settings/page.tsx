"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "../../UserContext"; // adjust if needed
import { authClient } from "@/app/lib/auth-client";

/* ---------- Types ---------- */
type Sentiment = "good" | "bad";

type GetPhrasesResp = {
  success?: boolean;
  userId?: string;
  count?: number;
  phrases?: {
    phrase_id: string;
    phrase: string;
    sentiment: Sentiment; // <-- now provided by your API
  }[];
  error?: string;
};

type GenerateNewPhrasesResp = {
  success?: boolean;
  userId?: string;
  input_count?: number;
  suggested_count?: number;
  existing_skipped?: number;
  // If your generate API now includes sentiment, keep it here (optional for UI)
  new_phrases?: { phrase: string; counts: number; sentiment?: Sentiment }[];
  usage?: unknown;
  error?: string;
};

type AddPhrasesResp = {
  success?: boolean;
  userId?: string;
  inserted?: { id: string; phrase: string; counts: number }[];
  updated?: { id: string; phrase: string; counts: number }[];
  skipped_invalid?: number;
  requested?: number;
  error?: string;
};

type DeleteResp = {
  success?: boolean;
  userId?: string;
  phrase_id?: string;
  deleted_excerpts?: number;
  error?: string;
};

/* ---------- Helpers ---------- */
function titleCase(s: string): string {
  // Simple title case: words split by whitespace and hyphen; preserves apostrophes.
  return s
    .toLowerCase()
    .split(/(\s+|-)/) // keep delimiters
    .map((tok) => {
      if (tok.trim() === "" || tok === "-") return tok;
      const first = tok.charAt(0).toUpperCase();
      return first + tok.slice(1);
    })
    .join("");
}

function parsePhrasesInput(raw: string): string[] {
  const parts = raw
    .split(/[\n,]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  }
  return out;
}

export default function ReviewSettings() {
  const { display } = useUser();
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user?.id || "";

  /* ---------- Page state ---------- */
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phrases, setPhrases] = useState<
    { phrase_id: string; phrase: string; sentiment: Sentiment }[]
  >([]);

  /* Add phrase state (now 2 boxes: good/bad) */
  const [newGoodPhraseInput, setNewGoodPhraseInput] = useState("");
  const [newBadPhraseInput, setNewBadPhraseInput] = useState("");
  const [addingGood, setAddingGood] = useState(false);
  const [addingBad, setAddingBad] = useState(false);
  const [addGoodMsg, setAddGoodMsg] = useState<string | null>(null);
  const [addBadMsg, setAddBadMsg] = useState<string | null>(null);
  const [addGoodIsError, setAddGoodIsError] = useState(false);
  const [addBadIsError, setAddBadIsError] = useState(false);
  const goodInputRef = useRef<HTMLInputElement | null>(null);
  const badInputRef = useRef<HTMLInputElement | null>(null);

  /* Delete state */
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [deleteIsError, setDeleteIsError] = useState(false);

  /* Generate new phrases (suggestions) modal state */
  const [genOpen, setGenOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<
    { phrase: string; counts: number; chosen: boolean; sentiment?: Sentiment }[]
  >([]);
  const [accepting, setAccepting] = useState(false);
  const [acceptMsg, setAcceptMsg] = useState<string | null>(null);
  const [acceptIsError, setAcceptIsError] = useState(false);

  /* ---------- Fetch phrases on load ---------- */
  // ---------- Fetch phrases on load ----------
const fetchPhrases = useCallback(async (uid: string) => {
  setLoading(true);
  setLoadError(null);
  try {
    const res = await fetch("/api/settings/review-settings/get-phrases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      // Ask backend for *all* phrases so ones without excerpts are included.
      body: JSON.stringify({ userId: uid, all: true, limit: 10000 }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(txt || `Failed to fetch phrases (${res.status})`);
    }
    const data: GetPhrasesResp = await res.json().catch(() => ({} as any));
    const items =
      (data?.phrases || []).map((p) => ({
        phrase_id: p.phrase_id,
        phrase: p.phrase,
        sentiment: p.sentiment,
      })) ?? [];
    setPhrases(items);
  } catch (e: any) {
    setLoadError(e?.message || "Failed to load phrases.");
  } finally {
    setLoading(false);
  }
}, []);


  useEffect(() => {
    if (isPending) return;
    if (!userId) {
      setLoading(false);
      setLoadError("You're not signed in.");
      return;
    }
    fetchPhrases(userId);
  }, [isPending, userId, fetchPhrases]);

  const hasPhrases = useMemo(() => phrases.length > 0, [phrases]);

  /* Group by sentiment */
  const goodPhrases = useMemo(
    () => phrases.filter((p) => p.sentiment === "good"),
    [phrases]
  );
  const badPhrases = useMemo(
    () => phrases.filter((p) => p.sentiment === "bad"),
    [phrases]
  );

  const refreshAll = useCallback(async () => {
    if (!userId) return;
    await fetchPhrases(userId);
  }, [userId, fetchPhrases]);

  /* ---------- Add GOOD phrases ---------- */
  const onAddGoodPhrases = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      setAddGoodMsg(null);
      setAddGoodIsError(false);

      if (!userId) {
        setAddGoodMsg("Missing user session.");
        setAddGoodIsError(true);
        return;
      }
      const parsed = parsePhrasesInput(newGoodPhraseInput);
      if (parsed.length === 0) {
        setAddGoodMsg("Please enter at least one phrase.");
        setAddGoodIsError(true);
        return;
      }

      // API accepts strings or { phrase, sentiment }. Send with sentiment.
      const payload = {
        userId,
        phrases: parsed.map((phrase) => ({ phrase, sentiment: "good" as const })),
      };

      setAddingGood(true);
      try {
        const res = await fetch("/api/settings/review-settings/add-phrases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data: AddPhrasesResp = await res.json().catch(() => ({} as any));
        if (!res.ok || data?.success === false) {
          throw new Error(data?.error || "Could not add phrases.");
        }
        const added = data?.inserted?.length ?? 0;
        const updated = data?.updated?.length ?? 0;
        setAddGoodMsg(
          added + updated > 0
            ? `Saved ${added} new phrase${added === 1 ? "" : "s"}${updated ? `, updated ${updated}.` : "."}`
            : "No changes."
        );
        setAddGoodIsError(false);
        setNewGoodPhraseInput("");
        await refreshAll();
        goodInputRef.current?.focus();
      } catch (err: any) {
        setAddGoodMsg(err?.message || "Could not add phrases.");
        setAddGoodIsError(true);
      } finally {
        setAddingGood(false);
      }
    },
    [userId, newGoodPhraseInput, refreshAll]
  );

  /* ---------- Add BAD phrases ---------- */
  const onAddBadPhrases = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      setAddBadMsg(null);
      setAddBadIsError(false);

      if (!userId) {
        setAddBadMsg("Missing user session.");
        setAddBadIsError(true);
        return;
      }
      const parsed = parsePhrasesInput(newBadPhraseInput);
      if (parsed.length === 0) {
        setAddBadMsg("Please enter at least one phrase.");
        setAddBadIsError(true);
        return;
      }

      const payload = {
        userId,
        phrases: parsed.map((phrase) => ({ phrase, sentiment: "bad" as const })),
      };

      setAddingBad(true);
      try {
        const res = await fetch("/api/settings/review-settings/add-phrases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data: AddPhrasesResp = await res.json().catch(() => ({} as any));
        if (!res.ok || data?.success === false) {
          throw new Error(data?.error || "Could not add phrases.");
        }
        const added = data?.inserted?.length ?? 0;
        const updated = data?.updated?.length ?? 0;
        setAddBadMsg(
          added + updated > 0
            ? `Saved ${added} new phrase${added === 1 ? "" : "s"}${updated ? `, updated ${updated}.` : "."}`
            : "No changes."
        );
        setAddBadIsError(false);
        setNewBadPhraseInput("");
        await refreshAll();
        badInputRef.current?.focus();
      } catch (err: any) {
        setAddBadMsg(err?.message || "Could not add phrases.");
        setAddBadIsError(true);
      } finally {
        setAddingBad(false);
      }
    },
    [userId, newBadPhraseInput, refreshAll]
  );

  /* ---------- Delete phrase (by phraseId) ---------- */
  const onDeletePhrase = useCallback(
    async (phrase_id: string, phrase_text: string) => {
      if (!userId) return;

      setDeleteMsg(null);
      setDeleteIsError(false);
      setDeletingId(phrase_id);

      try {
        const res = await fetch("/api/settings/review-settings/delete-phrases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            userId,
            phraseId: phrase_id,
          }),
        });

        const data: DeleteResp = await res.json().catch(() => ({} as any));
        if (!res.ok || data?.success !== true) {
          throw new Error(data?.error || "Could not delete phrase.");
        }

        setPhrases((prev) => prev.filter((p) => p.phrase_id !== phrase_id));

        const exCount =
          typeof data?.deleted_excerpts === "number" ? data.deleted_excerpts : 0;
        setDeleteMsg(
          `Deleted phrase “${titleCase(phrase_text)}”${exCount ? ` and ${exCount} excerpt(s)` : ""}.`
        );
      } catch (e: any) {
        setDeleteMsg(e?.message || "Could not delete phrase.");
        setDeleteIsError(true);
      } finally {
        setDeletingId(null);
      }
    },
    [userId]
  );

  /* ---------- Generate new phrases (open modal with suggestions) ---------- */
  const onGenerateNewPhrases = useCallback(async () => {
    if (!userId) return;
    setGenError(null);
    setGenerating(true);
    setSuggestions([]);
    try {
      const res = await fetch("/api/settings/review-settings/generate-new-phrases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ userId }),
      });
      const data: GenerateNewPhrasesResp = await res.json().catch(() => ({} as any));
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || "Failed to generate phrases.");
      }
      const items = (data?.new_phrases ?? []).map((x) => ({
        phrase: x.phrase,
        counts: x.counts ?? 0,
        chosen: true,
        sentiment: x.sentiment, // may be undefined; UI doesn't require it
      }));
      setSuggestions(items);
      setGenOpen(true);
    } catch (err: any) {
      setGenError(err?.message || "Failed to generate phrases.");
      setGenOpen(true);
    } finally {
      setGenerating(false);
    }
  }, [userId]);

  const onToggleSuggestion = useCallback((idx: number) => {
    setSuggestions((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], chosen: !copy[idx].chosen };
      return copy;
    });
  }, []);

  const anyChosen = useMemo(() => suggestions.some((s) => s.chosen), [suggestions]);

  // ---------- Accept suggestions (keep modal open + auto-refresh) ----------
const onAcceptSuggestions = useCallback(async () => {
  setAcceptMsg(null);
  setAcceptIsError(false);
  if (!userId) return;

  const selected = suggestions.filter((s) => s.chosen);
  if (selected.length === 0) {
    setAcceptMsg("Select at least one phrase to add.");
    setAcceptIsError(true);
    return;
  }

  setAccepting(true);
  try {
    const res = await fetch("/api/settings/review-settings/add-generated-phrases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        // include sentiment for each phrase (fallback to "good" if missing)
        phrases: selected.map((s) => ({
          phrase: s.phrase,
          counts: s.counts,
          sentiment: s.sentiment === "bad" ? "bad" : "good",
        })),
      }),
    });
    const data: AddPhrasesResp = await res.json().catch(() => ({} as any));
    if (!res.ok || data?.success === false) {
      throw new Error(data?.error || "Could not add selected phrases.");
    }

    // Refresh the list shown on the page
    await refreshAll();

    // ✅ Close modal after successful add
    setGenOpen(false);
    setSuggestions([]); // optional: clear suggestions after close
    setAcceptMsg(null); // optional: clear modal message since it's closed
  } catch (err: any) {
    setAcceptMsg(err?.message || "Could not add selected phrases.");
    setAcceptIsError(true);
  } finally {
    setAccepting(false);
  }
}, [suggestions, userId, refreshAll]);




  /* ---------- UI ---------- */
  return (
    <main className=" max-w-3xl px-6 py-8">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-gray-900">
            {display ? `${display} Review Settings` : "Review Settings"}
          </h1>
          <p className="text-sm text-gray-600">Manage keywords used for excerpt detection.</p>
        </div>

        <button
          type="button"
          onClick={onGenerateNewPhrases}
          disabled={!userId || generating}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
          title="Generate ~10 fresh phrases from your most recent reviews"
        >
          {generating ? "Generating…" : "Generate new phrases"}
        </button>
      </header>

      {/* Load status / error */}
      {loading ? (
        <div className="mb-6">
          <div className="mb-2 h-4 w-40 animate-pulse rounded bg-gray-100" />
          <div className="mb-2 h-4 w-64 animate-pulse rounded bg-gray-100" />
          <div className="h-4 w-56 animate-pulse rounded bg-gray-100" />
        </div>
      ) : loadError ? (
        <div className="mb-6 border-l-4 border-red-500 bg-red-50 px-4 py-2 text-sm text-red-800">
          {loadError}
        </div>
      ) : null}

      {/* Add phrases (now split Good / Bad) */}
      {!loading && !loadError && (
        <>
          <section className="mb-8">
            <h2 className="mb-2 text-sm font-medium text-gray-900">Add phrases</h2>

            <div className="grid gap-3 md:grid-cols-2">
              {/* GOOD */}
              <form onSubmit={onAddGoodPhrases} className="rounded-lg border border-gray-200 p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Add good phrases
                </h3>
                <div className="flex items-center gap-2">
                  <input
                    ref={goodInputRef}
                    type="text"
                    value={newGoodPhraseInput}
                    onChange={(e) => setNewGoodPhraseInput(e.target.value)}
                    placeholder="e.g., Great Communication, Friendly Staff"
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  />
                  <button
                    type="submit"
                    disabled={addingGood || !userId}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                    title="Add good phrase(s)"
                  >
                    {addingGood ? "Adding…" : "Add"}
                  </button>
                </div>
                {addGoodMsg && (
                  <div
                    className={`mt-3 border-l-4 px-3 py-2 text-sm ${
                      addGoodIsError
                        ? "border-red-500 bg-red-50 text-red-800"
                        : "border-emerald-600 bg-emerald-50 text-emerald-800"
                    }`}
                  >
                    {addGoodMsg}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-gray-500">Separate with commas or new lines to add multiple.</p>
              </form>

              {/* BAD */}
              <form onSubmit={onAddBadPhrases} className="rounded-lg border border-gray-200 p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-700">
                  Add bad phrases
                </h3>
                <div className="flex items-center gap-2">
                  <input
                    ref={badInputRef}
                    type="text"
                    value={newBadPhraseInput}
                    onChange={(e) => setNewBadPhraseInput(e.target.value)}
                    placeholder="e.g., Long Wait Times, Poor Communication"
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-rose-300"
                  />
                  <button
                    type="submit"
                    disabled={addingBad || !userId}
                    className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-rose-300"
                    title="Add bad phrase(s)"
                  >
                    {addingBad ? "Adding…" : "Add"}
                  </button>
                </div>
                {addBadMsg && (
                  <div
                    className={`mt-3 border-l-4 px-3 py-2 text-sm ${
                      addBadIsError
                        ? "border-red-500 bg-red-50 text-red-800"
                        : "border-rose-600 bg-rose-50 text-rose-800"
                    }`}
                  >
                    {addBadMsg}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-gray-500">Separate with commas or new lines to add multiple.</p>
              </form>
            </div>

            <p className="mt-2 text-xs text-gray-500">
              Tip: keep phrases short and generic (e.g., “Pricing”, “Communication”, “Aftercare”).
            </p>
          </section>

          {/* Phrases list (grouped by sentiment) */}
          <section className="mb-4">
            <h2 className="mt-2 text-sm font-medium text-gray-900">Your phrases</h2>
            <p className="mb-2 text-xs text-gray-500">The good phrases are given to clients allowing them to autogenerate reviews</p>

            {!hasPhrases ? (
              <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                No phrases yet. Click <strong>Generate new phrases</strong> or add your own above.
              </div>
            ) : (
              <>
                {deleteMsg && (
                  <div
                    className={`mb-3 border-l-4 px-3 py-2 text-sm ${
                      deleteIsError
                        ? "border-red-500 bg-red-50 text-red-800"
                        : "border-amber-500 bg-amber-50 text-amber-800"
                    }`}
                  >
                    {deleteMsg}
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  {/* GOOD group */}
                  <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-emerald-700">Good ({goodPhrases.length})</h3>
                    </div>
                    {goodPhrases.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                        No good phrases yet.
                      </div>
                    ) : (
                      <ul className="flex flex-wrap gap-2">
                        {goodPhrases.map((p) => (
                          <li
                            key={p.phrase_id}
                            className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-900"
                            title={titleCase(p.phrase)}
                          >
                            <span className="font-medium">{titleCase(p.phrase)}</span>
                            <button
                              type="button"
                              onClick={() => onDeletePhrase(p.phrase_id, p.phrase)}
                              className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded hover:bg-emerald-100 text-emerald-700"
                              aria-label={`Delete ${p.phrase}`}
                              title={`Delete ${titleCase(p.phrase)}`}
                            >
                              {deletingId === p.phrase_id ? (
                                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
                                  <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" />
                                </svg>
                              ) : (
                                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                                  <path
                                    d="M9 3h6m-9 4h12m-1 0-.8 11.2a2 2 0 0 1-2 1.8H8.8a2 2 0 0 1-2-1.8L6 7m3 4v6m6-6v6"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* BAD group */}
                  <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-rose-700">Bad ({badPhrases.length})</h3>
                    </div>
                    {badPhrases.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                        No bad phrases yet.
                      </div>
                    ) : (
                      <ul className="flex flex-wrap gap-2">
                        {badPhrases.map((p) => (
                          <li
                            key={p.phrase_id}
                            className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-900"
                            title={titleCase(p.phrase)}
                          >
                            <span className="font-medium">{titleCase(p.phrase)}</span>
                            <button
                              type="button"
                              onClick={() => onDeletePhrase(p.phrase_id, p.phrase)}
                              className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded hover:bg-rose-100 text-rose-700"
                              aria-label={`Delete ${p.phrase}`}
                              title={`Delete ${titleCase(p.phrase)}`}
                            >
                              {deletingId === p.phrase_id ? (
                                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
                                  <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" />
                                </svg>
                              ) : (
                                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                                  <path
                                    d="M9 3h6m-9 4h12m-1 0-.8 11.2a2 2 0 0 1-2 1.8H8.8a2 2 0 0 1-2-1.8L6 7m3 4v6m6-6v6"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>
        </>
      )}

      {/* ---------- Generate New Phrases Modal (title-case display only) ---------- */}
      {genOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Generated phrases"
          onKeyDown={(e) => e.key === "Escape" && setGenOpen(false)}
        >
          <div className="absolute inset-0 bg-black/40" onClick={() => setGenOpen(false)} aria-hidden="true" />
          <div className="relative z-10 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/10">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Suggested phrases</h2>
              <button
                type="button"
                onClick={() => setGenOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-5">
              {/* Current phrases (read-only) */}
              <section className="md:col-span-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800">Current phrases</h3>
                  <span className="text-xs text-gray-500">{phrases.length}</span>
                </div>
                {phrases.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-white p-3 text-xs text-gray-600">
                    You don’t have any phrases yet.
                  </div>
                ) : (
                  <div className="max-h-56 overflow-auto pr-1">
                    <ul className="flex flex-wrap gap-2">
                      {phrases.map((p) => (
                        <li
                          key={p.phrase_id}
                          className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-800"
                          title={titleCase(p.phrase)}
                        >
                          {titleCase(p.phrase)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="mt-2 text-[11px] text-gray-500">Manage additions or deletions in the main list.</p>
              </section>

              {/* Suggestions */}
              <section className="md:col-span-3">
                {genError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {genError}
                  </div>
                ) : suggestions.length === 0 ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-sm text-gray-700">
                    No new phrases were suggested.
                  </div>
                ) : (
                  <>
                    <p className="mb-3 text-sm text-gray-600">
                      These are the new phrases detected. Uncheck any you don’t want to add.
                    </p>
                    <ul className="divide-y divide-gray-100 border rounded-xl">
                      {suggestions.map((s, idx) => (
                        <li key={s.phrase} className="flex items-center justify-between p-3">
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={s.chosen}
                              onChange={() => onToggleSuggestion(idx)}
                              className="h-4 w-4"
                            />
                            <span className="text-sm font-medium text-gray-800">
                              {titleCase(s.phrase)}
                            </span>
                          </label>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-600">mentions: {s.counts}</span>
                            {s.sentiment && (
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  s.sentiment === "good"
                                    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                                    : "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                                }`}
                              >
                                {s.sentiment.toUpperCase()}
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>

                    {acceptMsg && (
                      <div
                        className={`mt-3 text-sm rounded-md px-3 py-2 ${
                          acceptIsError
                            ? "bg-red-50 text-red-700 border border-red-200"
                            : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        }`}
                      >
                        {acceptMsg}
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setGenOpen(false)}
                        className="rounded-lg bg-gray-100 px-4 py-2 text-gray-800 hover:bg-gray-200"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={onAcceptSuggestions}
                        disabled={!anyChosen || accepting}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-blue-300"
                      >
                        {accepting ? "Adding…" : "Accept changes"}
                      </button>
                    </div>
                  </>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
