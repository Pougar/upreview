"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "../../../UserContext"; // adjust the relative path if needed

type FormState = {
  name: string;
  email: string;
  phone_number: string;
  sentiment: "good" | "bad" | "unreviewed";
  review: string;
};

export default function AddClientPage() {
  const router = useRouter();
  const { name: username, display } = useUser(); // provided by your layout’s <UserProvider />
  const [form, setForm] = useState<FormState>({
    name: "",
    email: "",
    phone_number: "",
    sentiment: "unreviewed",
    review: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const update =
    (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOkMsg(null);

    // minimal client-side validation
    if (!form.name.trim()) {
      setErr("Name is required.");
      return;
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setErr("Please enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/add-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim() || null,
          phone_number: form.phone_number.trim() || null,
          sentiment: form.sentiment,
          review: form.review.trim() || null,
        }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `Request failed (${res.status})`);
      }

      setOkMsg("Client added successfully.");
      // redirect back to the clients list
      router.push(`/${username}/dashboard/clients`);
    } catch (e: any) {
      setErr(e?.message || "Failed to add client.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 p-6">
      <div className="mx-auto w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Add Client</h1>
          <p className="text-sm text-gray-500">
            New client will be linked to <span className="font-semibold">{display}</span>.
          </p>
        </header>

        <form onSubmit={onSubmit} className="space-y-5">
          {/* Name */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={update("name")}
              className="w-full rounded-lg border border-gray-300 p-2 focus:border-blue-500 focus:outline-none"
              placeholder="Jane Smith"
              required
            />
          </div>

          {/* Email */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={update("email")}
              className="w-full rounded-lg border border-gray-300 p-2 focus:border-blue-500 focus:outline-none"
              placeholder="jane@example.com"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Phone number</label>
            <input
              type="tel"
              value={form.phone_number}
              onChange={update("phone_number")}
              className="w-full rounded-lg border border-gray-300 p-2 focus:border-blue-500 focus:outline-none"
              placeholder="+61 412 345 678"
            />
          </div>

          {/* Sentiment */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Sentiment</label>
            <select
              value={form.sentiment}
              onChange={update("sentiment")}
              className="w-full rounded-lg border border-gray-300 p-2 focus:border-blue-500 focus:outline-none"
            >
              <option value="unreviewed">Unreviewed</option>
              <option value="good">Good</option>
              <option value="bad">Bad</option>
            </select>
          </div>

          {/* Review */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Review</label>
            <textarea
              value={form.review}
              onChange={update("review")}
              className="min-h-[120px] w-full rounded-lg border border-gray-300 p-2 focus:border-blue-500 focus:outline-none"
              placeholder="Write the client's review (optional)…"
            />
          </div>

          {/* Alerts */}
          {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}
          {okMsg && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{okMsg}</p>}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? "Adding…" : "Add Client"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
