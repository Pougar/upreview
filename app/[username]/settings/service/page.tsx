"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "../../UserContext"; // { name, display }

export default function EmailTemplateSettings() {
  const { name, display } = useUser(); // display may be null
  const senderName = display ?? "Your company";

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const [origSubject, setOrigSubject] = useState("");
  const [origBody, setOrigBody] = useState("");

  const [previewRecipient, setPreviewRecipient] = useState("Customer");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = subject !== origSubject || body !== origBody;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/email-template", { cache: "no-store" });
        const p = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) {
          setError(p?.error === "UNAUTHENTICATED" ? "Please sign in again." : "Could not load your email template.");
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
        setError(p?.error === "UNAUTHENTICATED" ? "Please sign in again." : p?.message || "Failed to save changes.");
        return;
      }
      setOrigSubject(p.email_subject ?? subject);
      setOrigBody(p.email_body ?? body);
      setMsg("Saved!");
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

  const previewText = `Hi ${previewRecipient || "Customer"},\n
${body}

Best regards,
${senderName}`;

  return (
    <main>
        {(error || msg) && (
          <div
            className={`mb-4 rounded-lg px-4 py-3 text-sm ${
              error ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"
            }`}
          >
            {error || msg}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Editor */}
          <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8">
            <h2 className="text-xl font-semibold text-gray-800 mb-1">Edit template</h2>
            <p className="text-gray-500 mb-6">These fields are the editable parts of your email.</p>

            {/* Subject */}
            <label className="block text-sm font-medium text-gray-700 mb-2">Subject</label>
            {loading ? (
              <div className="h-10 w-full rounded-lg bg-gray-200 animate-pulse mb-4" />
            ) : (
              <input
                type="text"
                className="border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-400 focus:outline-none transition"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            )}
            <div className="text-xs text-gray-500 mt-1">{subject.length}/200</div>

            {/* Body */}
            <label className="block text-sm font-medium text-gray-700 mt-6 mb-2">Body</label>
            {loading ? (
              <div className="h-40 w-full rounded-lg bg-gray-200 animate-pulse mb-4" />
            ) : (
              <textarea
                className="border border-gray-300 rounded-lg px-4 py-3 w-full h-48 focus:ring-2 focus:ring-blue-400 focus:outline-none transition"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            )}
            <div className="text-xs text-gray-500 mt-1">{body.length}/8000</div>

            {/* Actions */}
            <div className="flex items-center gap-3 mt-6">
              <button
                onClick={handleSave}
                disabled={saving || loading || !dirty}
                className="bg-blue-600 text-white px-5 py-2.5 rounded-lg shadow hover:bg-blue-700 disabled:bg-gray-400 transition"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={loading || (!dirty && !error && !msg)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Live preview */}
            <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8">
            <div className="flex items-center justify-between">
                <div>
                <h2 className="text-xl font-semibold text-gray-800 mb-1">Preview</h2>
                <p className="text-gray-500 mb-6">
                    Greeting and sign-off are added automatically and are not editable here.
                </p>
                </div>
                {/* Non-persistent preview control */}
                <div className="text-right">
                <label className="block text-xs text-gray-500 mb-1">Preview recipient name</label>
                <input
                    className="border border-gray-300 rounded-md px-2 py-1 text-sm w-44 focus:ring-2 focus:ring-blue-400 focus:outline-none transition"
                    value={previewRecipient}
                    onChange={(e) => setPreviewRecipient(e.target.value)}
                />
                </div>
            </div>

            <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                <div className="text-xs text-gray-500">Subject</div>
                <div className="font-medium text-gray-900 truncate">
                    {loading ? <span className="inline-block h-5 w-1/2 bg-gray-200 animate-pulse" /> : subject}
                </div>
                </div>

                <div className="p-4">
                {loading ? (
                <>
                    <div className="h-4 w-7/12 bg-gray-200 animate-pulse mb-2" />
                    <div className="h-4 w-10/12 bg-gray-200 animate-pulse mb-2" />
                    <div className="h-4 w-9/12 bg-gray-200 animate-pulse mb-2" />
                    <div className="h-4 w-6/12 bg-gray-200 animate-pulse" />
                </>
                ) : (
                <div className="text-gray-800 leading-relaxed space-y-4">
                    {/* Greeting */}
                    <p>Hi {previewRecipient || "Customer"},</p>

                    {/* Body */}
                    <p className="whitespace-pre-wrap">{body}</p>

                    {/* --- Buttons preview (before sign-off) --- */}
                    <div className="mt-6 flex gap-3">
                    <a
                        href="http://localhost:3000/example-review"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-green-700"
                    >
                        Happy
                    </a>
                    <a
                        href="http://localhost:3000/example-review"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-red-700"
                    >
                        Unsatisfied
                    </a>
                    </div>

                    {/* Sign-off */}
                    <p>
                    Best regards,<br />
                    {senderName}
                    </p>
                </div>
                )}
                </div>
            </div>

            <div className="text-xs text-gray-400 mt-4">
                Tip: the greeting/sign-off are added when sending; you only edit the middle content here.
            </div>
            <div className="text-xs text-gray-400">
                From name: <span className="text-gray-700">{senderName}</span>
            </div>
            </div>
        </div>
    </main>
  );
}
