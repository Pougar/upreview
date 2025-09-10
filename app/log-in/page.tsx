"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/app/lib/auth-client"; //import the auth client

export default function Login() {

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleLogInSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        const { data, error } = await authClient.signIn.email({
            email,
            password,
            rememberMe: true
        });
        if (error) {
          setMessage(error?.message || error?.toString() || "Unknown error"); // show error to user
          setLoading(false);
          return;
        }

        if (data) {
          // Login succeeded
          router.push("/dashboard"); // redirect to protected page
        }

        setLoading(false);
    
    };

    return (
      <main className="min-h-screen flex flex-col items-center justify-center">
        <Link 
            href="/"
            className="absolute top-4 left-4 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 transition"
            >
            Back
        </Link>
        {message && <p style={{ color: "red" }}>{message}</p>}
        <form onSubmit={handleLogInSubmit} className="gap-2">
          <div className="relative bg-gray-200 dark:bg-gray-700 rounded-lg shadow-lg w-96 h-70 flex flex-col items-center justify-center gap-6">
            <h1 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">Log In</h1>
              <input
                type="email"
                placeholder="Email"
                value={email}
                className="border rounded px-3 py-2 w-64"
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                className="border rounded px-3 py-2 w-64"
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button 
              type="submit" 
              disabled={!email || !password || loading}
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-400"
              >
              {loading ? "Logging in..." : "Log in"}
              </button>
            </div>
        </form>
          <Link href="/sign-up" className="hover:underline">Don&apos;t have an account yet?{" "}Click here to sign up</Link>

      </main>
      );

}