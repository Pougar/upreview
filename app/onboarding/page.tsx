// app/[username]/onboarding-step-1/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/app/lib/auth-client"; // better-auth/react createClient()

// Same slugify rules as your API
function slugify(input: string, maxLen = 60): string {
  const ascii = input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, maxLen)
    .replace(/^-+|-+$/g, "");
}

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Session (hooks first, always)
  const { data: session, isPending } = authClient.useSession();

  // userID: prefer query param, fallback to session
  const authUserIdFromQuery = searchParams.get("userID") ?? "";
  const authUserId = authUserIdFromQuery || session?.user?.id || "";
  const accountEmail = session?.user?.email ?? "";

  // Form state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [googleLink, setGoogleLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [submitIsError, setSubmitIsError] = useState(false);

  // Check if already onboarded
  const [checkingOnboarded, setCheckingOnboarded] = useState(true);

  useEffect(() => {
    let alive = true;
    async function checkOnboarded() {
      if (!authUserId) {
        if (alive) setCheckingOnboarded(false);
        return;
      }
      try {
        const res = await fetch("/api/check-onboarded", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: authUserId }),
        });
        if (!res.ok) throw new Error("Failed to check onboarding");
        const data = await res.json();
        if (alive && data?.onboarded === true) {
          router.push("/log-in");
          return;
        }
      } catch (err) {
        console.error("Error checking onboarding:", err);
      } finally {
        if (alive) setCheckingOnboarded(false);
      }
    }
    checkOnboarded();
    return () => {
      alive = false;
    };
  }, [authUserId, router]);

  /* ---------- NEW: Prefill Business Name + Email from API ---------- */
  const prefilledOnceRef = useRef(false);
  useEffect(() => {
    if (!authUserId || prefilledOnceRef.current) return;

    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/onboarding-get-user-details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: authUserId }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          console.warn("onboarding-get-user-details: non-OK", res.status);
          prefilledOnceRef.current = true;
          return;
        }
        const data: { name?: string | null; email?: string | null } = await res.json().catch(() => ({} as any));

        // Only prefill if the fields are still empty, so we don't overwrite user typing
        if (!businessName && data?.name) setBusinessName(data.name);
        if (!businessEmail && (data?.email || accountEmail)) {
          setBusinessEmail((data?.email ?? accountEmail) as string);
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          console.error("Failed to fetch onboarding user details:", e);
        }
      } finally {
        prefilledOnceRef.current = true;
      }
    })();

    return () => ctrl.abort();
  }, [authUserId, businessName, businessEmail, accountEmail]);
  /* ----------------------------------------------------------------- */

  // Validation helpers
  const emailIsValid = useMemo(
    () => !businessEmail || /.+@.+\..+/.test(businessEmail.trim()),
    [businessEmail]
  );
  const googleLinkIsValid = useMemo(() => {
    if (!googleLink.trim()) return true;
    try {
      const u = new URL(googleLink);
      return ["google.com", "business.google.com", "g.page", "maps.app.goo.gl", "maps.google.com"]
        .some(d => u.hostname.includes(d));
    } catch {
      return false;
    }
  }, [googleLink]);

  // Live slug + URL preview
  const slug = useMemo(() => slugify(businessName), [businessName]);
  const prettyURL = useMemo(
    () => (slug ? `/${slug}/dashboard` : "/[your-business]/dashboard"),
    [slug]
  );

  const canContinue =
    businessName.trim().length > 1 &&
    !!slug &&
    (!!accountEmail && /.+@.+\..+/.test(accountEmail)) &&
    emailIsValid &&
    googleLinkIsValid &&
    !!authUserId;

  // File handlers
  const handleFilePick = () => fileInputRef.current?.click();
  const handleFile = (f?: File) => {
    if (!f) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview((e.target?.result as string) || null);
    reader.readAsDataURL(f);
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  };
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(true);
  };
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(false);
  };

  // Submit
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canContinue) return;

    setSubmitting(true);
    setSubmitMsg(null);
    setSubmitIsError(false);

    try {
      // 1) Create the user in Neon
      const res = await fetch("/api/add-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: authUserId,
          email: accountEmail,
          businessName,
          businessEmail: businessEmail || undefined,
          googleBusinessLink: googleLink || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setSubmitMsg(data?.message || data?.error || "Sorry, we couldn’t create your account.");
        setSubmitIsError(true);
        setSubmitting(false);
        return;
      }

      // 2) Upload logo if one was chosen
      if (file) {
        try {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("userId", authUserId);

          const uploadRes = await fetch("/api/upload-company-logo", {
            method: "POST",
            body: fd,
          });

          if (!uploadRes.ok) {
            console.warn("Logo upload failed:", await uploadRes.text());
          }
        } catch (err) {
          console.error("Error uploading logo:", err);
        }
      }

      // 3) Redirect to next step
      setSubmitMsg("Account created! Redirecting…");
      setSubmitIsError(false);
      const redirectSlug = slugify(businessName);
      setTimeout(() => router.push(`/link-xero?userID=${encodeURIComponent(authUserId)}`), 600);
    } catch {
      setSubmitMsg("Network error. Please try again.");
      setSubmitIsError(true);
    } finally {
      setSubmitting(false);
    }
  }

  // Loading gates
  if (isPending || checkingOnboarded) {
    return (
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center" }}>
        Loading…
      </div>
    );
  }

  if (!accountEmail || !authUserId) {
    return (
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", padding: 24 }}>
        Missing authentication context. Please sign in.
      </div>
    );
  }

  // Styles
  const card: React.CSSProperties = {
    width: "100%", maxWidth: 720, background: "#fff",
    border: "1px solid #e5e7eb", borderRadius: 16, padding: 24
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex flex-col">
      {/* Sticky timeline header (Step 1 of 3) */}
      <div className="sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-white/50 bg-white/70 border-b border-white/60">
        <div className="mx-auto max-w-5xl px-6 py-3">
          <Stepper current={1} labels={["Set up account", "Link services", "Review overview"]} />
          <p className="mt-1 text-xs font-medium text-gray-700 text-center">Step 1 of 3</p>
        </div>
      </div>

      {/* Form */}
      <main className="flex-1 flex items-center justify-center px-6 py-6">
        <form onSubmit={handleSubmit} style={card}>
          <h1 style={{ marginTop: 0 }}>Finish setting up your account</h1>

          {/* Business Name */}
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            <label htmlFor="businessName" style={{ fontWeight: 600 }}>Business Name *</label>
            <input
              id="businessName"
              value={businessName}
              onChange={e => setBusinessName(e.target.value)}
              placeholder="Acme Dental Clinic"
              style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "12px 14px" }}
              required
            />
            {/* Slugified URL preview */}
            <div style={{
              fontSize: 12, color: "#475569", background: "#f8fafc",
              border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px"
            }}>
              Your URL would look like:{" "}
              <code style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                {prettyURL}
              </code>
            </div>
          </div>

          {/* Business Email (optional) */}
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            <label htmlFor="businessEmail" style={{ fontWeight: 600 }}>Business Email (optional)</label>
            <input
              id="businessEmail"
              type="email"
              value={businessEmail}
              onChange={e => setBusinessEmail(e.target.value)}
              placeholder="hello@acmedental.com"
              style={{
                border: `1px solid ${businessEmail ? (emailIsValid ? "#cbd5e1" : "#ef4444") : "#cbd5e1"}`,
                borderRadius: 10, padding: "12px 14px"
              }}
            />
            {!emailIsValid && businessEmail && (
              <div style={{ fontSize: 12, color: "#b91c1c" }}>Please enter a valid email address.</div>
            )}
          </div>

          {/* Google Business Link (optional) */}
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            <label htmlFor="googleLink" style={{ fontWeight: 600 }}>Google Business / Maps Link (optional)</label>
            <input
              id="googleLink"
              type="url"
              value={googleLink}
              onChange={e => setGoogleLink(e.target.value)}
              placeholder="https://g.page/your-business or https://maps.google.com/..."
              style={{
                border: `1px solid ${googleLink ? (googleLinkIsValid ? "#cbd5e1" : "#ef4444") : "#cbd5e1"}`,
                borderRadius: 10, padding: "12px 14px"
              }}
            />
            {!googleLinkIsValid && googleLink && (
              <div style={{ fontSize: 12, color: "#b91c1c" }}>
                That doesn’t look like a valid Google Business/Maps link.
              </div>
            )}
          </div>

          {/* Company Photo */}
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            <label style={{ fontWeight: 600 }}>Company Photo / Logo</label>
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInputRef.current?.click()}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              style={{
                border: `2px dashed ${dragActive ? "#2563eb" : "#cbd5e1"}`,
                borderRadius: 14, padding: 16, textAlign: "center",
                background: dragActive ? "#eff6ff" : "#f8fafc"
              }}
            >
              <div style={{ fontWeight: 600 }}>
                {dragActive ? "Drop to upload" : "Drag & drop your image here"}
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>or click to choose a file</div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleFile(e.target.files?.[0] ?? undefined)}
                style={{ display: "none" }}
              />
            </div>
            {imagePreview && (
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <img
                  src={imagePreview}
                  alt="Company preview"
                  style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 12, border: "1px solid #e5e7eb" }}
                />
                <div style={{ fontSize: 12, color: "#64748b" }}>{file?.name}</div>
              </div>
            )}
          </div>

          {/* Submit feedback */}
          {submitMsg && (
            <div
              role="status"
              aria-live="polite"
              style={{
                fontSize: 13,
                color: submitIsError ? "#b91c1c" : "#065f46",
                background: submitIsError ? "#fee2e2" : "#ecfdf5",
                border: `1px solid ${submitIsError ? "#fecaca" : "#a7f3d0"}`,
                padding: 10, borderRadius: 8, marginTop: 12
              }}
            >
              {submitMsg}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 16 }}>
            <button
              type="button"
              onClick={() => router.push("/")}
              style={{ border: "1px solid #cbd5e1", background: "#fff", padding: "10px 14px", borderRadius: 10, fontWeight: 600 }}
            >
              Skip for now
            </button>
            <button
              type="submit"
              disabled={!canContinue || submitting}
              style={{
                border: "1px solid #0ea5e9",
                background: !canContinue || submitting ? "#bae6fd" : "#0ea5e9",
                color: "#fff", padding: "10px 14px", borderRadius: 10, fontWeight: 600,
                cursor: !canContinue || submitting ? "not-allowed" : "pointer"
              }}
            >
              {submitting ? "Creating…" : "Create account"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

/* ---------- Stepper (visual only) ---------- */
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
