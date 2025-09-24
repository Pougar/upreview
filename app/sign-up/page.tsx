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
    const { error: signUpErr, data } = await authClient.signUp.email(
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
            // Don’t block onboarding redirect if logging fails
            console.error("Failed to record sign-in action:", err);
            }

            // 2) Redirect to onboarding with userID in query
            router.push(`/onboarding?userID=${encodeURIComponent(user.id)}`);
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

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-blue-100 via-purple-100 to-pink-100">
      <Link
        href="/"
        className="absolute top-4 left-4 bg-blue-500 text-white px-4 py-2 rounded-lg shadow hover:bg-blue-600 transition"
      >
        Back
      </Link>

      <div className="flex flex-col items-center justify-center">
        {error && <p className="text-red-500 mb-2">{error}</p>}
        {password !== password2 && (
          <p className="text-red-500 mb-2">Passwords do not match</p>
        )}

        <form onSubmit={handleSignUpSubmit}>
          <div className="relative bg-white rounded-2xl shadow-2xl w-96 p-10 flex flex-col items-center">
            <h1 className="text-3xl font-bold text-gray-800 mb-6">Sign Up</h1>

            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Company Name"
              className="border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-400 focus:outline-none transition"
            />

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="border border-gray-300 rounded-lg px-4 py-2 w-full mt-4 focus:ring-2 focus:ring-blue-400 focus:outline-none transition"
            />

            <h2 className="text-xl font-semibold text-gray-700 mt-6">
              New Password
            </h2>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New Password"
              className="border border-gray-300 rounded-lg px-4 py-2 w-full mt-2 focus:ring-2 focus:ring-blue-400 focus:outline-none transition"
            />

            <input
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              placeholder="Confirm Password"
              className="border border-gray-300 rounded-lg px-4 py-2 w-full mt-2 focus:ring-2 focus:ring-blue-400 focus:outline-none transition"
            />

            <button
              onClick={handleSignUpSubmit}
              disabled={loading || !email || !password || password !== password2}
              className="bg-blue-500 text-white px-6 py-3 rounded-lg mt-6 w-full hover:bg-blue-600 disabled:bg-gray-400 transition"
            >
              {loading ? "Signing up..." : "Sign up"}
            </button>
          </div>
        </form>
      </div>

      <Link href="/log-in" className="mt-4 text-blue-600 hover:underline">
        Already have an account? Click here to log in
      </Link>
    </main>
  );
}
