"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter, usePathname } from "next/navigation";

/* ==== Redirect handoff helpers ==== */
const REDIRECT_STORAGE_KEY = "pendingGoogleReviewRedirect";
function redirectToGoogleCountdown(
  router: ReturnType<typeof useRouter>,
  url: string | null | undefined,
  review: string,
  seconds = 5
) {
  if (!url) return;
  try {
    sessionStorage.setItem(REDIRECT_STORAGE_KEY, JSON.stringify({ url, review }));
  } catch {}
  router.push(`/redirect?s=${encodeURIComponent(String(seconds))}`);
}

export default function SubmitReviewPage() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  // Route param: submit-review/[clientId]
  const { clientId } = useParams() as { clientId: string };

  // Query param: ?userID=...
  const ownerUserId = (search.get("userID") || "").trim();

  const type = (search.get("type") || "").toLowerCase();
  const isGood = type === "good";
  const isBad = type === "bad";

  const [status, setStatus] =
    useState<"idle" | "updating" | "updated" | "already" | "error">("idle");
  const [reviewText, setReviewText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [submitIsError, setSubmitIsError] = useState(false);

  // Only need Google reviews link client-side now
  const [googleLink, setGoogleLink] = useState<string | null>(null);

  // Phrases (chips) + selection
  const [availablePhrases, setAvailablePhrases] = useState<string[]>([]);
  const [phrasesLoading, setPhrasesLoading] = useState(false);
  const [phrasesError, setPhrasesError] = useState<string | null>(null);
  const [selectedPhrases, setSelectedPhrases] = useState<string[]>([]);

  // Generation state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Star rating
  const [stars, setStars] = useState<number>(isGood ? 5 : 0);
  useEffect(() => {
    setStars(isGood ? 5 : 0);
  }, [isGood]);

  // ✅ Validation: only check userID exists in DB when in tester mode
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!clientId) {
        router.replace("/error");
        return;
      }

      if (clientId === "test") {
        if (!ownerUserId) {
          router.replace("/error");
          return;
        }
        try {
          const res = await fetch("/api/settings/user-settings/get-business-info", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: ownerUserId }),
            cache: "no-store",
          });
          if (!alive) return;
          if (!res.ok) {
            router.replace("/error");
          }
        } catch {
          if (alive) router.replace("/error");
        }
        return;
      }

      if (!ownerUserId || (!isGood && !isBad)) {
        router.replace("/error");
      }
    })();

    return () => {
      alive = false;
    };
  }, [clientId, ownerUserId, isGood, isBad, router]);

  // ⛳ Review-clicked / email-sent checks — SKIP COMPLETELY IN TEST MODE
  useEffect(() => {
    let alive = true;
    if (!clientId) return;

    if (clientId === "test") {
      setStatus("updated");
      return;
    }

    (async () => {
      try {
        setStatus("updating");
        const res = await fetch("/api/reviews/review-clicked-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId }),
        });

        if (!alive) return;

        if (res.status === 403) {
          const data = await res.json().catch(() => ({}));
          if (data?.error === "EMAIL_NOT_SENT" || data?.error === "REVIEW_ALREADY_SUBMITTED") {
            router.replace("/error");
            return;
          }
        }

        if (!res.ok) {
          setStatus("error");
          router.replace("/error");
          return;
        }

        const data = await res.json().catch(() => ({}));
        if (data?.already) setStatus("already");
        else setStatus("updated");
      } catch {
        if (alive) {
          setStatus("error");
          router.replace("/error");
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [clientId, router]);

  // Tabs
  function switchType(newType: "good" | "bad") {
    const params = new URLSearchParams(search.toString());
    params.set("type", newType);
    router.replace(`${pathname}?${params.toString()}`);
  }

  // Load Google Business link
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!ownerUserId) return;
      try {
        const res = await fetch("/api/settings/user-settings/get-business-info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: ownerUserId }),
        });
        if (!alive) return;
        if (!res.ok) return;

        const data = await res.json().catch(() => ({}));
        const link = typeof data?.googleBusinessLink === "string" ? data.googleBusinessLink.trim() : "";
        setGoogleLink(link || null);
      } catch {
        if (!alive) return;
        setGoogleLink(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ownerUserId]);

  // Load phrases using ownerUserId (GOOD sentiment only)
useEffect(() => {
  let alive = true;
  const ctrl = new AbortController();

  async function fetchGoodPhrases(uid: string) {
    setPhrasesLoading(true);
    setPhrasesError(null);

    const collected: string[] = [];

    // keep only items with sentiment === 'good'
    const pushGood = (arr: any[]) => {
      for (const item of arr) {
        const obj = typeof item === "string" ? { phrase: item } : (item || {});
        const phrase = String(obj?.phrase ?? "").trim();
        const sentiment = String(obj?.sentiment ?? "").toLowerCase();
        if (phrase && sentiment === "good") {
          collected.push(phrase);
        }
      }
    };

    // 1) Try primary full-list endpoint (if it returns sentiment)
    try {
      let cursor: string | null = null;
      const MAX_PAGES = 20;
      let pages = 0;

      do {
        const body: any = { userId: uid, limit: 1000 };
        // If your API accepts a sentiment filter, uncomment the next line:
        // body.sentiment = "good";

        const res = await fetch("/api/reviews/get-phrases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
          cache: "no-store",
        });

        if (!alive) return;

        if (!res.ok) throw new Error("fallback");
        const data: any = await res.json().catch(() => ({}));
        const list = Array.isArray(data?.phrases) ? data.phrases : [];
        pushGood(list);

        cursor =
          (data?.nextCursor as string) ??
          (data?.next_page_token as string) ??
          null;
        pages += 1;
      } while (cursor && pages < MAX_PAGES);
    } catch {
      // 2) Fallback: analytics endpoint (returns sentiment)
      try {
        const res = await fetch("/api/analytics/get-phrases-excerpts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: uid, all: true, limit: 10000 }),
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!alive) return;
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || `Failed to load phrases (${res.status})`);
        }
        const data: any = await res.json().catch(() => ({}));
        // This endpoint returns items like { phrase_id, phrase, sentiment, ... }
        const list = Array.isArray(data?.phrases) ? data.phrases : [];
        pushGood(list);
      } catch (e: any) {
        if (!alive) return;
        setPhrasesError(e?.message || "Failed to load phrases.");
        setAvailablePhrases([]);
        setSelectedPhrases([]);
        setPhrasesLoading(false);
        return;
      }
    }

    // De-dupe case-insensitively, keep first occurrence
    const seen = new Set<string>();
    const unique = collected.filter((p) => {
      const k = p.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (!alive) return;
    setAvailablePhrases(unique);

    // Keep any previously selected phrases that still exist (good-only)
    setSelectedPhrases((prev) =>
      prev.filter((p) => unique.some((u) => u.toLowerCase() === p.toLowerCase()))
    );

    setPhrasesLoading(false);
  }

  if (ownerUserId) {
    fetchGoodPhrases(ownerUserId);
  } else {
    setAvailablePhrases([]);
    setSelectedPhrases([]);
  }

  return () => {
    alive = false;
    ctrl.abort();
  };
}, [ownerUserId]);


  // Generate review — only needs userId, clientId, phrases
  const onGenerate = useCallback(async () => {
    setAiError(null);

    if (selectedPhrases.length === 0) {
      setAiError("Choose at least one phrase to include.");
      return;
    }

    setAiLoading(true);
    try {
      const payload = { userId: ownerUserId, clientId, phrases: selectedPhrases };

      const r2 = await fetch("/api/reviews/generate-good-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!r2.ok) {
        const t = await r2.text().catch(() => "");
        throw new Error(t || "Failed to generate review");
      }

      const d2: any = await r2.json().catch(() => ({}));
      const reviews = Array.isArray(d2?.reviews) ? d2.reviews : [];
      const generated = (reviews[0] || "").trim();
      if (!generated) throw new Error("No review text returned.");
      setReviewText(generated);
    } catch {
      setAiError("Couldn't generate a review. Please try again.");
    } finally {
      setAiLoading(false);
    }
  }, [ownerUserId, clientId, selectedPhrases]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitMsg(null);
    setSubmitIsError(false);
    setSubmitting(true);

    // Tester mode: no DB writes.
    if (clientId === "test") {
      try {
        const textToCopy = (reviewText || "").trim();
        if (textToCopy) {
          try { await navigator.clipboard.writeText(textToCopy); } catch {}
        }
        setSubmitMsg(isGood ? "Copied your review. Redirecting to Google…" : "Copied your feedback.");
        setSubmitIsError(false);
        // Only redirect to Google for GOOD reviews in tester mode
        if (isGood && googleLink) {
          redirectToGoogleCountdown(router, googleLink, (reviewText || "").trim(), 5);
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Normal flow
    try {
      const res = await fetch("/api/reviews/submit-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          userId: ownerUserId,
          reviewType: isGood ? "good" : "bad",
          review: reviewText,
          stars,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setSubmitMsg("Thanks for your review! 💙");
        setSubmitIsError(false);
        if (isGood && googleLink) {
          redirectToGoogleCountdown(router, googleLink, (reviewText || "").trim(), 5);
        }
      } else if (res.status === 409 && data?.error === "REVIEW_ALREADY_SUBMITTED") {
        setSubmitMsg("You’ve already submitted a review for this visit.");
        setSubmitIsError(true);
      } else if (res.status === 404) {
        setSubmitMsg("We couldn’t find your record. Please check your link.");
        setSubmitIsError(true);
      } else {
        setSubmitMsg(data?.error || "Sorry, we couldn’t save your review.");
        setSubmitIsError(true);
      }
    } catch {
      setSubmitMsg("Network error. Please try again.");
      setSubmitIsError(true);
    } finally {
      setSubmitting(false);
    }
  }

  const accent = isGood ? "#16a34a" : "#dc2626";
  const header = "Leave Your Review";

  const tabBase: React.CSSProperties = {
    padding: "0.5rem 0.75rem",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontWeight: 600,
    color: "#374151",
    borderBottom: "2px solid transparent",
  };
  const activeTab = (selected: boolean): React.CSSProperties => ({
    ...tabBase,
    color: selected ? "#111827" : "#374151",
    borderBottomColor: selected ? (selected ? (isGood ? "#16a34a" : "#dc2626") : "transparent") : "transparent",
  });

  const chip = (selected: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
    padding: "0.4rem 0.65rem",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 9999,
    cursor: "pointer",
    userSelect: "none",
    border: selected ? "1px solid #16a34a" : "1px solid #d1d5db",
    background: selected ? "rgba(16, 163, 74, 0.1)" : "#fff",
    color: selected ? "#065f46" : "#374151",
  });

  const starBtn = (filled: boolean): React.CSSProperties => ({
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: 24,
    lineHeight: 1,
    padding: "0 2px",
    color: filled ? "#f59e0b" : "#d1d5db",
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "#f9fafb",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          background: "#fff",
          padding: "2rem",
          borderRadius: "8px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          maxWidth: "960px",
          width: "100%",
        }}
      >
        {/* Tabs: Good + Bad */}
        <div
          role="tablist"
          aria-label="Review type"
          style={{
            display: "flex",
            gap: "0.5rem",
            borderBottom: "1px solid #e5e7eb",
            marginBottom: "1rem",
          }}
        >
          <button
            role="tab"
            aria-selected={isGood}
            onClick={() => switchType("good")}
            style={{
              ...tabBase,
              color: isGood ? "#111827" : "#374151",
              borderBottomColor: isGood ? "#16a34a" : "transparent",
            }}
          >
            Good
          </button>
          <button
            role="tab"
            aria-selected={isBad}
            onClick={() => switchType("bad")}
            style={{
              ...tabBase,
              color: isBad ? "#111827" : "#374151",
              borderBottomColor: isBad ? "#dc2626" : "transparent",
            }}
          >
            Bad
          </button>
        </div>

        <h1 style={{ marginBottom: "0.25rem", fontSize: "1.5rem", color: "#111827" }}>
          {header}
        </h1>

        <p style={{ marginTop: 0, marginBottom: "1rem", fontSize: 12, color: "#6b7280" }}>
          {status === "updating" && "Loading..."}
          {status === "updated" && "Thanks for clicking through 💙"}
          {status === "error" && "Could not record your visit."}
          {status === "idle" && ""}
        </p>

        {/* Star rating */}
        <div
          role="radiogroup"
          aria-label="Rating from 0 to 5 stars"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: "0.75rem",
          }}
        >
          <button
            type="button"
            role="radio"
            aria-checked={stars === 0}
            onClick={() => setStars(0)}
            style={{ ...chip(stars === 0), padding: "0.3rem 0.55rem" }}
            title="Zero stars"
          >
            0★
          </button>
          <div aria-hidden="true" style={{ display: "flex", alignItems: "center" }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={stars === n}
                aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
                onClick={() => setStars(n)}
                style={starBtn(n <= stars)}
              >
                {n <= stars ? "★" : "☆"}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 12, color: "#6b7280" }}>{stars} / 5</span>
        </div>

        <form onSubmit={handleSubmit}>
          {isGood ? (
            <>
              {/* Phrase chips */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  marginBottom: "0.75rem",
                }}
              >
                {phrasesLoading ? (
                  <span style={{ fontSize: 12, color: "#6b7280" }}>Loading phrases…</span>
                ) : phrasesError ? (
                  <span style={{ fontSize: 12, color: "#b91c1c" }}>{phrasesError}</span>
                ) : availablePhrases.length === 0 ? (
                  <span style={{ fontSize: 12, color: "#6b7280" }}>
                    No phrases yet. You can still write your own review below.
                  </span>
                ) : (
                  availablePhrases.map((p) => {
                    const selected = selectedPhrases.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() =>
                          setSelectedPhrases((prev) =>
                            prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
                          )
                        }
                        aria-pressed={selected}
                        style={chip(selected)}
                        title={selected ? "Click to remove" : "Click to add"}
                      >
                        {p}
                        {selected ? (
                          <span aria-hidden>×</span>
                        ) : (
                          <span
                            aria-hidden
                            style={{
                              width: 14,
                              height: 14,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: 9999,
                              border: "1px solid #d1d5db",
                              fontSize: 10,
                            }}
                          >
                            +
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {/* Generate button + status */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <button
                  type="button"
                  onClick={onGenerate}
                  disabled={aiLoading || availablePhrases.length === 0}
                  style={{
                    background: aiLoading ? "#93c5fd" : "#2563eb",
                    color: "#fff",
                    padding: "0.55rem 1rem",
                    border: "none",
                    borderRadius: 6,
                    fontWeight: 700,
                    cursor: aiLoading ? "not-allowed" : "pointer",
                    fontSize: 14,
                  }}
                >
                  {aiLoading ? "Generating…" : "Generate review"}
                </button>
                <span style={{ fontSize: 12, color: "#6b7280" }}>
                  Choose phrases, then generate. You can edit the text below before submitting.
                </span>
              </div>

              {aiError && (
                <div style={{ color: "#b91c1c", fontSize: 13, marginBottom: 12 }} aria-live="polite">
                  {aiError}
                </div>
              )}

              {/* “OR write your own” */}
              <div
                style={{
                  border: "1px solid #d1d5db",
                  borderRadius: 8,
                  padding: 12,
                  background: "#fff",
                  marginBottom: 12,
                }}
              >
                <h3 style={{ margin: 0, marginBottom: 8, fontSize: 14, fontWeight: 700, color: "#065f46" }}>
                  OR Write your own review here
                </h3>
                <textarea
                  placeholder="Write your own review here:"
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                  style={{
                    width: "100%",
                    minHeight: "120px",
                    padding: "0.75rem",
                    borderRadius: "6px",
                    border: "1px solid #d1d5db",
                    fontSize: "1rem",
                    background: "#fff",
                  }}
                />
              </div>
            </>
          ) : (
            // BAD flow: simple textarea
            <textarea
              placeholder="Tell us what we can improve..."
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              required
              style={{
                width: "100%",
                minHeight: "120px",
                padding: "0.75rem",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                marginBottom: "0.75rem",
                fontSize: "1rem",
              }}
            />
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            style={{
              background: submitting ? "#93c5fd" : (isGood ? "#16a34a" : "#dc2626"),
              color: "#fff",
              padding: "0.75rem 1.5rem",
              border: "none",
              borderRadius: "6px",
              fontSize: "1rem",
              fontWeight: "bold",
              cursor: submitting ? "not-allowed" : "pointer",
              marginTop: "0.75rem",
            }}
          >
            {submitting ? "Submitting..." : (clientId === "test" ? (isGood ? "Copy & Open Google" : "Copy") : "Submit")}
          </button>

          {/* Helper text under GOOD */}
          {isGood && (
            <p
              style={{
                marginTop: "0.5rem",
                fontSize: 12,
                color: "#9ca3af",
                fontStyle: "italic",
              }}
            >
              {clientId === "test"
                ? "We’ll copy your review and (for happy reviews) open your Google reviews page. No data is saved."
                : "After submitting, we’ll show a quick countdown and then take you to your Google reviews page."}
            </p>
          )}

          {submitMsg && (
            <div
              style={{
                marginTop: "0.5rem",
                fontSize: 13,
                color: submitIsError ? "#b91c1c" : "#065f46",
              }}
              aria-live="polite"
            >
              {submitMsg}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
