"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useSearchParams, useRouter, usePathname } from "next/navigation";

export default function SubmitReviewPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { clientId } = useParams() as { clientId: string };
  const search = useSearchParams();

  const type = (search.get("type") || "").toLowerCase();
  const isGood = type === "good";
  const isBad = type === "bad";

  const [status, setStatus] =
    useState<"idle" | "updating" | "updated" | "already" | "error">("idle");
  const [reviewText, setReviewText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [submitIsError, setSubmitIsError] = useState(false);

  // Validate basic inputs
  useEffect(() => {
    if (!clientId || (!isGood && !isBad)) {
      console.log("Invalid access - missing or incorrect parameters");
      router.replace("/error");
    }
  }, [clientId, isGood, isBad, router]);

  // Mark review_clicked = true on first visit
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!clientId) return;
      try {
        setStatus("updating");
        const res = await fetch("/api/review-clicked-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId }),
        });

        if (!alive) return;

        if (res.status === 403) {
          const data = await res.json().catch(() => ({}));
          if (
            data?.error === "EMAIL_NOT_SENT" ||
            data?.error === "REVIEW_ALREADY_SUBMITTED"
          ) {
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

  // Switch between good/bad tabs by updating query param
  function switchType(newType: "good" | "bad") {
    const params = new URLSearchParams(search.toString());
    params.set("type", newType);
    router.replace(`${pathname}?${params.toString()}`);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitMsg(null);
    setSubmitIsError(false);
    setSubmitting(true);
    try {
      const res = await fetch("/api/submit-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          reviewType: isGood ? "good" : "bad",
          review: reviewText,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setSubmitMsg("Thanks for your review! 💙");
        setSubmitIsError(false);
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
  const header = isGood ? "Leave Your Review" : "Leave Your Review";

  // Simple styles for Google-like tabs (text buttons with bottom border on active)
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
    borderBottomColor: selected ? accent : "transparent",
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
          maxWidth: "560px",
          width: "100%",
        }}
      >
        {/* Tabs */}
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
            style={activeTab(isGood)}
          >
            Good
          </button>
          <button
            role="tab"
            aria-selected={isBad}
            onClick={() => switchType("bad")}
            style={activeTab(isBad)}
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
          {/* Removed the 'already' text as requested */}
          {status === "error" && "Could not record your visit."}
          {status === "idle" && ""}
        </p>

        <form onSubmit={handleSubmit}>
          <textarea
            placeholder={isGood ? "Tell us what went well..." : "Tell us what we can improve..."}
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
          <button
            type="submit"
            disabled={submitting}
            style={{
              background: submitting ? "#93c5fd" : accent,
              color: "#fff",
              padding: "0.75rem 1.5rem",
              border: "none",
              borderRadius: "6px",
              fontSize: "1rem",
              fontWeight: "bold",
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "Submitting..." : "Submit"}
          </button>

          {submitMsg && (
            <div
              style={{
                marginTop: "0.75rem",
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
