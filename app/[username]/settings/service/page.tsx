"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useUser } from "../../UserContext";
import { authClient } from "@/app/lib/auth-client";

export default function EmailTemplateSettings() {
  const { name, display } = useUser();
  const senderName = display ?? "Your company";

  const { data: session } = authClient.useSession();
  const authUserId = session?.user?.id ?? "";
  const accountEmail = session?.user?.email ?? "no-reply@upreview.app";

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const [origSubject, setOrigSubject] = useState("");
  const [origBody, setOrigBody] = useState("");

  const [previewRecipient, setPreviewRecipient] = useState("Customer");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Test email state
  const [testSending, setTestSending] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testIsError, setTestIsError] = useState(false);

  // Prefill test recipient
  const [testRecipient, setTestRecipient] = useState("");
  const [emailLoading, setEmailLoading] = useState(true);
  const [emailLoadErr, setEmailLoadErr] = useState<string | null>(null);

  // NEW: preview modal
  const [previewOpen, setPreviewOpen] = useState(false);

  const dirty = subject !== origSubject || body !== origBody;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/email-template", { cache: "no-store" });
        const p = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) {
          setError(
            p?.error === "UNAUTHENTICATED"
              ? "Please sign in again."
              : "Could not load your email template."
          );
        } else {
          setSubject(p.email_subject ?? "");
          setBody(p.email_body ?? "");
          setOrigSubject(p.email_subject ?? "");
          setOrigBody(p.email_body ?? "");
        }
      } catch {
        if (!alive) return;
        setError("Network error while loading.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!authUserId) return;
    setEmailLoading(true);
    setEmailLoadErr(null);

    (async () => {
      try {
        const res = await fetch("/api/settings/user-settings/get-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: authUserId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!alive) return;

        if (!res.ok) {
          setEmailLoadErr(
            data?.error === "MISSING_USER_ID"
              ? "Missing user session."
              : data?.error === "NOT_FOUND"
              ? "Email not found for your account."
              : "Could not load your email."
          );
          setTestRecipient("");
        } else {
          const email = typeof data?.email === "string" ? data.email.trim() : "";
          setTestRecipient(email);
        }
      } catch {
        if (!alive) return;
        setEmailLoadErr("Network error while loading your email.");
        setTestRecipient("");
      } finally {
        if (alive) setEmailLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [authUserId]);

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      const r = await fetch("/api/email-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_subject: subject, email_body: body }),
      });
      const p = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(
          p?.error === "UNAUTHENTICATED"
            ? "Please sign in again."
            : p?.message || "Failed to save changes."
        );
        return;
      }
      setOrigSubject(p.email_subject ?? subject);
      setOrigBody(p.email_body ?? body);
      setMsg("Saved.");
    } catch {
      setError("Network error while saving.");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setSubject(origSubject);
    setBody(origBody);
    setMsg(null);
    setError(null);
  }

  const emailLooksValid = (s: string) => /^\S+@\S+\.\S+$/.test(s);

  async function handleSendTestEmail() {
    setTestMsg(null);
    setTestIsError(false);

    const to = (testRecipient || "").trim();
    if (!to || !emailLooksValid(to)) {
      setTestMsg("Please enter a valid email address.");
      setTestIsError(true);
      return;
    }

    setTestSending(true);
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: "test", email: to, toEmail: to }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data?.error === "UNAUTHENTICATED"
            ? "Please sign in to send a test email."
            : data?.error || "Failed to send test email.";
        throw new Error(msg);
      }
      setTestMsg(`Test email sent to ${to}.`);
      setTestIsError(false);
    } catch (e: any) {
      setTestMsg(e?.message || "Failed to send test email.");
      setTestIsError(true);
    } finally {
      setTestSending(false);
    }
  }

  // --- helpers for preview ---
  const senderInitial = useMemo(
    () => (senderName.trim()[0] || "U").toUpperCase(),
    [senderName]
  );
  const nowStr = useMemo(() => new Date().toLocaleString(), []);
  const toDisplay = useMemo(
    () => (previewRecipient?.trim() ? previewRecipient.trim() : "Customer"),
    [previewRecipient]
  );
  const toEmail = useMemo(
    () => (testRecipient?.trim() ? testRecipient.trim() : "name@example.com"),
    [testRecipient]
  );

  return (
    <main className=" max-w-3xl px-6 py-8">
      {/* Page title */}
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">
          Email template
        </h1>
        <p className="text-sm text-gray-600">
          Adjust the subject and body used for outreach emails.
        </p>
      </header>

      {(error || msg) && (
        <div
          className={`mb-6 border-l-4 px-4 py-2 text-sm ${
            error
              ? "border-red-500 bg-red-50 text-red-800"
              : "border-emerald-600 bg-emerald-50 text-emerald-800"
          }`}
        >
          {error || msg}
        </div>
      )}

      {/* Editor (single column) */}
      <section>
        <h2 className="mb-1 text-sm font-medium text-gray-900">Edit template</h2>
        <p className="mb-5 text-sm text-gray-600">
          These are the editable parts of your email.
        </p>

        {/* Subject */}
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Subject
        </label>
        {loading ? (
          <div className="mb-3 h-10 w-full animate-pulse rounded-md bg-gray-100" />
        ) : (
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        )}
        <div className="mt-1 text-xs text-gray-500">{subject.length}/200</div>

        {/* Body */}
        <label className="mt-6 mb-1 block text-sm font-medium text-gray-700">
          Body
        </label>
        {loading ? (
          <div className="mb-3 h-40 w-full animate-pulse rounded-md bg-gray-100" />
        ) : (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="h-48 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        )}
        <div className="mt-1 text-xs text-gray-500">{body.length}/8000</div>

        {/* Actions */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || loading || !dirty}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={loading || (!dirty && !error && !msg)}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset
          </button>

          {/* NEW: Preview trigger */}
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            disabled={loading}
            className="ml-auto rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed"
          >
            Preview email
          </button>
        </div>
      </section>

      {/* Send Test Email */}
      <section className="mt-10 border-t border-gray-200 pt-6">
        <h2 className="mb-3 text-sm font-medium text-gray-900">Send a test email</h2>

        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <label className="text-sm text-gray-700">Send to</label>

          <input
            type="email"
            value={testRecipient}
            onChange={(e) => setTestRecipient(e.target.value)}
            placeholder="name@example.com"
            className={`w-full rounded-md border px-3 py-2 sm:w-80 focus:outline-none focus:ring-2 ${
              testRecipient && !/^\S+@\S+\.\S+$/.test(testRecipient)
                ? "border-red-400 focus:ring-red-200"
                : "border-gray-300 focus:ring-blue-200"
            }`}
            disabled={emailLoading}
          />

          <button
            type="button"
            onClick={handleSendTestEmail}
            disabled={testSending || emailLoading}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
          >
            {testSending ? "Sending…" : "Send"}
          </button>
        </div>

        {emailLoadErr && (
          <div className="mt-2 text-sm text-red-600">{emailLoadErr}</div>
        )}

        {testMsg && (
          <div
            className={`mt-3 border-l-4 px-3 py-2 text-sm ${
              testIsError
                ? "border-red-500 bg-red-50 text-red-800"
                : "border-emerald-600 bg-emerald-50 text-emerald-800"
            }`}
          >
            {testMsg}
          </div>
        )}
      </section>

{/* ---------- PREVIEW MODAL (drop-in replacement) ---------- */}
{previewOpen && (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
    aria-label="Preview email"
    onKeyDown={(e) => e.key === "Escape" && setPreviewOpen(false)}
  >
    {/* Backdrop */}
    <div
      className="absolute inset-0 bg-black/40"
      onClick={() => setPreviewOpen(false)}
      aria-hidden="true"
    />

    {/* Modal card */}
    <div className="relative z-10 w-full max-w-3xl max-h-[85vh] rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 overflow-hidden flex flex-col">
      {/* Header (with Close button) */}
      <div className="flex items-start justify-between gap-4 p-6 pb-0">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900">Email preview</h3>
          <p className="text-sm text-gray-600">Greeting and sign-off are added automatically.</p>
        </div>

        <div className="flex items-start gap-3">
          <div className="text-right">
            <input
              value={previewRecipient}
              onChange={(e) => setPreviewRecipient(e.target.value)}
              className="w-44 rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {/* Close (X) */}
          <button
            type="button"
            onClick={() => setPreviewOpen(false)}
            aria-label="Close preview"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6l-12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="p-6 pt-4 overflow-auto">
        {/* Gmail-like container */}
        <div className="overflow-hidden rounded-md border border-gray-200">
          {/* Subject bar */}
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <div className="text-xs text-gray-500">Subject</div>
            <div className="font-medium text-gray-900">
              {loading ? (
                <span className="inline-block h-5 w-1/2 animate-pulse rounded bg-gray-200" />
              ) : (
                subject
              )}
            </div>
          </div>

          {/* Message body */}
          <div className="p-4">
            {loading ? (
              <>
                <div className="mb-2 h-4 w-7/12 animate-pulse rounded bg-gray-200" />
                <div className="mb-2 h-4 w-10/12 animate-pulse rounded bg-gray-200" />
                <div className="mb-2 h-4 w-9/12 animate-pulse rounded bg-gray-200" />
                <div className="h-4 w-6/12 animate-pulse rounded bg-gray-200" />
              </>
            ) : (
              <div className="space-y-4 text-gray-800">
                <p>Hi {previewRecipient || "Customer"},</p>

                <p className="whitespace-pre-wrap">{body}</p>

                {/* Mock CTA buttons */}
                <div className="mt-6 flex gap-3">
                  <a
                    href="#"
                    className="inline-block rounded-md bg-green-600 px-3 py-1.5 text-sm font-semibold text-white no-underline hover:bg-green-700"
                    onClick={(e) => e.preventDefault()}
                  >
                    Happy
                  </a>
                  <a
                    href="#"
                    className="inline-block rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white no-underline hover:bg-red-700"
                    onClick={(e) => e.preventDefault()}
                  >
                    Unsatisfied
                  </a>
                </div>

                <p>
                  Best regards,
                  <br />
                  {senderName}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  </div>
)}


    </main>
  );
}
