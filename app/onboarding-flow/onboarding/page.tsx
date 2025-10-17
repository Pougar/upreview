// app/onboarding-flow/onboarding/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/app/lib/auth-client";

/* ===== Onboarding flow guard (unchanged) ===== */
const NEXT_STEP_API = "/api/next-user-step";
const CURRENT_ACTION = "finished_onboarding" as const;
const CURRENT_PAGE_URL = "/onboarding-flow/onboarding";
/* ============================================ */

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
  const { data: session, isPending } = authClient.useSession();

  // Prefer query param "UserID", fall back to "userID", then session
  const qpUserUpper = searchParams.get("UserID") ?? "";
  const qpUserLower = searchParams.get("userID") ?? "";
  const authUserId = qpUserUpper || qpUserLower || session?.user?.id || "";
  const accountEmail = session?.user?.email ?? "";

  // Form state (unchanged)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [googleLink, setGoogleLink] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [submitIsError, setSubmitIsError] = useState(false);

  const [detailsLoading, setDetailsLoading] = useState(true);

  /* ---------- Prefill user details (unchanged) ---------- */
  useEffect(() => {
    let alive = true;
    if (!authUserId) {
      setDetailsLoading(false);
      return;
    }
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/onboarding-get-user-details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: authUserId }),
          signal: ctrl.signal,
        });
        if (!alive) return;

        if (res.ok) {
          const data: {
            name?: string | null;
            email?: string | null;
            description?: string | null;
            googleReviewLink?: string | null;
          } = await res.json().catch(() => ({} as any));

          if (data?.name) setBusinessName(data.name);
          if (data?.email || accountEmail) setBusinessEmail((data?.email ?? accountEmail) as string);
          if (data?.description) setDescription(data.description);
          if (data?.googleReviewLink) setGoogleLink(data.googleReviewLink);
        }
      } catch (_) {
        // non-fatal
      } finally {
        if (alive) setDetailsLoading(false);
      }
    })();
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [authUserId, accountEmail]);

  /* ---------- Validation (unchanged) ---------- */
  const emailIsValid = useMemo(
    () => !businessEmail || /.+@.+\..+/.test(businessEmail.trim()),
    [businessEmail]
  );
  const googleLinkIsValid = useMemo(() => {
    if (!googleLink.trim()) return true;
    try {
      const u = new URL(googleLink);
      return ["google.com", "business.google.com", "g.page", "maps.app.goo.gl", "maps.google.com"].some(
        (d) => u.hostname.includes(d)
      );
    } catch {
      return false;
    }
  }, [googleLink]);

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

  /* ---------- File handlers (unchanged) ---------- */
  const handleFile = (f?: File) => {
    if (!f) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview((e.target?.result as string) || null);
    reader.readAsDataURL(f);
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  };
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  /* ---------- Submit (unchanged) ---------- */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canContinue) return;

    setSubmitting(true);
    setSubmitMsg(null);
    setSubmitIsError(false);

    try {
      // 1) Create the user
      const res = await fetch("/api/add-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: authUserId,
          email: accountEmail,
          businessName,
          businessEmail: businessEmail || undefined,
          googleBusinessLink: googleLink || undefined,
          description: description || null,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setSubmitMsg(data?.message || data?.error || "Sorry, we couldn’t create your account.");
        setSubmitIsError(true);
        setSubmitting(false);
        return;
      }

      // 2) Upload logo if chosen
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
      setTimeout(
        () => router.push(`/onboarding-flow/link-xero?UserID=${encodeURIComponent(authUserId)}`),
        600
      );
    } catch {
      setSubmitMsg("Network error. Please try again.");
      setSubmitIsError(true);
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------- Loading / auth gates ---------- */
  if (isPending || detailsLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-white text-slate-700">
        Loading…
      </div>
    );
  }

  if (!accountEmail || !authUserId) {
    return (
      <div className="min-h-screen grid place-items-center bg-white text-slate-700 p-6">
        Missing authentication context. Please sign in.
      </div>
    );
  }

  /* ---------- Page (simplified, left-aligned) ---------- */
  return (
    <div className="bg-white text-slate-900">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        {/* Brand */}
        <div className="mb-5">
          <span className="rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
            upreview
          </span>
        </div>

        {/* Title */}
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Finish setting up your account
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          A few details to personalize your workspace. You can change these later in settings.
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          {/* Business Name */}
          <div>
            <label htmlFor="businessName" className="block text-sm font-medium text-slate-800">
              Business name <span className="text-rose-600">*</span>
            </label>
            <input
              id="businessName"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Your business name"
              autoComplete="organization"
              required
              className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
            />
            <div className="mt-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5">
              Your URL would look like:{" "}
              <code className="font-mono">{prettyURL}</code>
            </div>
          </div>

          {/* Business Email (optional) */}
          <div>
            <label htmlFor="businessEmail" className="block text-sm font-medium text-slate-800">
              Business email <span className="text-slate-500 font-normal">(optional)</span>
            </label>
            <input
              id="businessEmail"
              type="email"
              value={businessEmail}
              onChange={(e) => setBusinessEmail(e.target.value)}
              placeholder="you@yourbusiness.com"
              autoComplete="email"
              className={`mt-2 block w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none ${
                businessEmail
                  ? emailIsValid
                    ? "border-slate-300 focus:border-blue-500"
                    : "border-rose-400 focus:border-rose-500"
                  : "border-slate-300 focus:border-blue-500"
              }`}
            />
            {!emailIsValid && businessEmail && (
              <p className="mt-1 text-xs text-rose-700">Please enter a valid email address.</p>
            )}
          </div>

          {/* Google Link (optional) */}
          <div>
            <label htmlFor="googleLink" className="block text-sm font-medium text-slate-800">
              Google Business / Maps link{" "}
              <span className="text-slate-500 font-normal">(optional)</span>
            </label>
            <input
              id="googleLink"
              type="url"
              value={googleLink}
              onChange={(e) => setGoogleLink(e.target.value)}
              placeholder="https://g.page/your-business or https://maps.google.com/..."
              autoComplete="url"
              className={`mt-2 block w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none ${
                googleLink
                  ? googleLinkIsValid
                    ? "border-slate-300 focus:border-blue-500"
                    : "border-rose-400 focus:border-rose-500"
                  : "border-slate-300 focus:border-blue-500"
              }`}
            />
            {!googleLinkIsValid && googleLink && (
              <p className="mt-1 text-xs text-rose-700">That doesn’t look like a valid Google Business/Maps link.</p>
            )}
          </div>

          {/* Company Description */}
          <div>
            <label htmlFor="companyDescription" className="block text-sm font-medium text-slate-800">
              Company description <span className="text-slate-500 font-normal">(optional)</span>
            </label>
            <textarea
              id="companyDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short summary of what you do."
              rows={4}
              className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Company Photo / Logo */}
          <div>
            <label className="block text-sm font-medium text-slate-800">Company photo / logo</label>
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInputRef.current?.click()}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              className={`mt-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
                dragActive
                  ? "border-blue-500 bg-blue-50"
                  : "border-slate-300 bg-slate-50 hover:bg-slate-100"
              }`}
            >
              <div className="text-sm font-semibold">
                {dragActive ? "Drop to upload" : "Drag & drop your image here"}
              </div>
              <div className="mt-1 text-xs text-slate-600">or click to choose a file</div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleFile(e.target.files?.[0] ?? undefined)}
                className="hidden"
              />
            </div>

            {imagePreview && (
              <div className="mt-3 flex items-center gap-3">
                <div
                  className="h-24 w-24 overflow-hidden rounded-full border border-slate-200 bg-white flex items-center justify-center"
                  aria-label="Company logo preview"
                >
                  <img
                    src={imagePreview}
                    alt="Company preview"
                    className="h-full w-full object-contain p-1.5"
                    draggable={false}
                  />
                </div>
                <div className="text-xs text-slate-600">{file?.name}</div>
              </div>
            )}
          </div>

          {/* Submit feedback */}
          {submitMsg && (
            <div
              role="status"
              aria-live="polite"
              className={`rounded-md border px-3 py-2 text-sm ${
                submitIsError
                  ? "border-rose-200 bg-rose-50 text-rose-800"
                  : "border-emerald-200 bg-emerald-50 text-emerald-800"
              }`}
            >
              {submitMsg}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => router.push("/")}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Skip for now
            </button>
            <button
              type="submit"
              disabled={!canContinue || submitting}
              className={`rounded-lg px-4 py-2.5 text-sm font-semibold text-white ${
                !canContinue || submitting
                  ? "bg-blue-300 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {submitting ? "Creating…" : "Create account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
