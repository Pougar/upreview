"use client";

import { authClient } from "@/app/lib/auth-client"; //import the auth client
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email || !name || !password || !password2) {
      setError("Please fill all fields.");
      return;
    }
    if (password !== password2) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    // 1) Pre-check availability BEFORE creating auth user
    try {
      const r = await fetch(
        `/api/name-availability?name=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}`
      );
      if (!r.ok) {
        const p = await r.json().catch(() => ({}));
        setError(p?.message || "That name is already taken.");
        setLoading(false);
        return; // cancel sign-up attempt
      }
    } catch {
      setError("Network error checking name. Please try again.");
      setLoading(false);
      return;
    }

    // 2) Proceed with auth sign up
    const { error: signUpErr } = await authClient.signUp.email(
      { email, password, name }, // name = display_name
      {
        onSuccess: async (ctx) => {
          try {
            const user = ctx.data?.user;
            if (!user?.id) throw new Error("MISSING_AUTH_USER");

            // 1) Record sign-in action
            try {
              await fetch("/api/record-sign-in", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: user.id }),
              });
            } catch (err) {
              console.error("Failed to record sign-in action:", err);
            }

            // 2) Redirect to onboarding with userID in query
            router.push(`/onboarding-flow/link-google?userID=${encodeURIComponent(user.id)}`);
          } catch {
            setError("Unexpected error finalizing your account.");
            setLoading(false);
          } finally {
            setLoading(false);
          }
        },
        onError: (ctx) => {
          setError(ctx.error?.message || "Sign up failed. Please try again.");
          setLoading(false);
        },
      }
    );

    if (signUpErr) {
      setError(signUpErr.message || "Sign up failed. Please try again.");
      setLoading(false);
    }
  }; // <- end handleSignUpSubmit

  const passwordsMismatch = password !== password2 && !!password2;

  return (
    <main className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2 bg-white">
      {/* LEFT: Form column */}
      <div className="relative flex min-h-screen items-center">
        {/* Top nav */}
        <div className="absolute left-6 top-6 flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-400"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path d="M10 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 12h18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Back
          </Link>
          <span className="ml-2 rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
            upreview
          </span>
        </div>

        <div className="mx-auto w-full max-w-md px-6">
          <header className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Welcome to upreview!</h1>
            <p className="mt-1 text-sm text-slate-500">Sign up to start collecting and understanding reviews.</p>
          </header>

          {(error || passwordsMismatch) && (
            <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {error ? <p>{error}</p> : null}
              {passwordsMismatch ? <p>Passwords do not match.</p> : null}
            </div>
          )}

          {/* Form is not “cardy”: just clean inputs with subtle borders */}
          <form onSubmit={handleSignUpSubmit} className="space-y-4">
            {/* Company name */}
            <div>
              <label htmlFor="company" className="mb-1 block text-sm font-medium text-slate-700">
                Company name
              </label>
              <input
                id="company"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder=""
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
                Work email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder=""
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
                New password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder=""
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
            </div>

            {/* Confirm password */}
            <div>
              <label htmlFor="password2" className="mb-1 block text-sm font-medium text-slate-700">
                Confirm password
              </label>
              <input
                id="password2"
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                placeholder=""
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
              <p className="mt-2 text-xs text-slate-500">Your password must contain at least 8 characters.</p>
            </div>

            <button
              onClick={handleSignUpSubmit}
              disabled={loading || !email || !password || password !== password2}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {loading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
                    <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" />
                  </svg>
                  Signing up…
                </>
              ) : (
                "Continue"
              )}
            </button>

            <p className="text-sm text-slate-600">
              Already have an account?{" "}
              <Link href="/log-in" className="font-medium text-slate-900 underline-offset-4 hover:underline">
                Log in
              </Link>
            </p>

            <p className="pt-2 text-xs text-slate-500">
              By signing up for an upreview account, you agree to our{" "}
              <span className="underline">Privacy Policy</span> and{" "}
              <span className="underline">Terms of Service</span>.
            </p>
          </form>
        </div>
      </div>

      {/* RIGHT: Hero / visual column (no card; soft, editorial look) */}
      <div className="hidden lg:block relative">
        <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_65%_35%,#fff7d6_0%,#fffaf0_40%,#fff_100%)]" />
        {/* Simple illustrative “mock” canvas (no external image) */}
        <div className="absolute left-1/2 top-1/2 -translate-x-2/5 -translate-y-1/2 w-[640px] max-w-[80%]">
          <div className="rounded-2xl border border-slate-200 bg-white/90 shadow-2xl ring-1 ring-black/5 backdrop-blur p-4">
            <div className="h-6 w-40 rounded-md bg-slate-100" />
            <div className="mt-3 grid grid-cols-6 gap-2">
              {[...Array(18)].map((_, i) => (
                <div key={i} className="h-10 rounded-md bg-slate-50 ring-1 ring-slate-200" />
              ))}
            </div>
          </div>
          <div className="mt-4 ml-8 h-6 w-56 rounded-full bg-blue-100" />
          <div className="mt-2 ml-20 h-6 w-40 rounded-full bg-emerald-100" />
        </div>

        <div className="absolute bottom-4 right-6 text-xs text-slate-500">
          © {new Date().getFullYear()} <span className="font-medium text-slate-700">upreview</span>
        </div>
      </div>
    </main>
  );
}
