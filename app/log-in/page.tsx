"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/app/lib/auth-client";

type GetNameApiOk =
  | {
      success: true;
      user: { name?: string | null; display_name?: string | null };
      missingMyuser?: false;
      source?: "myusers";
    }
  | {
      success: true;
      user: { id: string }; // returned from users table fallback
      missingMyuser: true;
      source?: "users";
    };

type GetNameApiErr = { error: string };

export default function Login() {
  const router = useRouter();
  const { data: session } = authClient.useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // prevent duplicate redirects
  const redirectingRef = useRef(false);

  const redirectUsingGetName = async (userId: string) => {
    if (!userId || redirectingRef.current) return;
    redirectingRef.current = true;

    try {
      const res = await fetch(`/api/get-name`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ id: userId }),
      });

      const data = (await res.json().catch(() => ({}))) as GetNameApiOk | GetNameApiErr;

      // If API indicates no myusers row exists → go to onboarding (link Google)
      if ((data as any)?.missingMyuser === true) {
        router.replace(`/onboarding-flow/link-google?UserID=${encodeURIComponent(userId)}`);
        return;
      }

      // Otherwise try to use the slug (name) from myusers
      const user = (data as any)?.user ?? {};
      const name = user?.name as string | undefined;

      if (name && typeof name === "string") {
        router.replace(`/${name}/dashboard`);
        return;
      }

      // Fallback: if no slug available, start onboarding
      router.replace(`/onboarding-flow/link-google?UserID=${encodeURIComponent(userId)}`);
    } catch (err) {
      console.error("Failed to resolve next route:", err);
      // Last resort: onboarding
      router.replace(`/onboarding-flow/link-google?UserID=${encodeURIComponent(userId)}`);
    }
  };

  // If already logged in, redirect appropriately
  useEffect(() => {
    if (!session?.user?.id) return;
    void redirectUsingGetName(session.user.id);
  }, [session?.user?.id]);

  const handleLogInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    setLoading(true);

    const { data, error } = await authClient.signIn.email({
      email,
      password,
      rememberMe: true,
    });

    if (error) {
      setMessage(error?.message || String(error) || "Unknown error");
      setLoading(false);
      return;
    }

    if (data?.user?.id) {
      await redirectUsingGetName(data.user.id);
    } else {
      setMessage("Login failed");
    }

    setLoading(false);
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-100 via-purple-100 to-pink-100">
      <Link
        href="/"
        className="absolute top-4 left-4 bg-blue-500 text-white px-4 py-2 rounded-lg shadow hover:bg-blue-600 transition"
      >
        Back
      </Link>

      {message && <p className="text-red-500 mb-2">{message}</p>}

      <form onSubmit={handleLogInSubmit}>
        <div className="bg-white rounded-2xl shadow-2xl w-96 p-10 flex flex-col items-center gap-6">
          <h1 className="text-3xl font-bold text-gray-800">Log In</h1>

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-400 focus:outline-none transition"
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-400 focus:outline-none transition"
            required
          />

          <button
            type="submit"
            disabled={!email || !password || loading}
            className="bg-blue-500 text-white px-6 py-3 rounded-lg w-full hover:bg-blue-600 disabled:bg-gray-400 transition"
          >
            {loading ? "Logging in..." : "Log in"}
          </button>
        </div>
      </form>

      <Link href="/sign-up" className="mt-4 text-blue-600 hover:underline">
        Don&apos;t have an account yet? Click here to sign up
      </Link>
    </main>
  );
}
