"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/app/lib/auth-client"; //import the auth client
import { useEffect } from "react";

export default function Login() {

  const { data: session } = authClient.useSession();

    useEffect(() => {
      if (!session) return;
    const redirect = async () => {
      await redirectToDashboard(session.user.id);
    };

  redirect();
  }, [session]);

    const redirectToDashboard = async (userId: string) => {
    try {
      const res = await fetch("/api/get-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId }),
      });
      const data = await res.json();
      if (data.name) {
        router.replace(`/${data.name}/dashboard`);
      }
    } catch (err) {
      console.error("Failed to fetch username:", err);
    }
  };

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleLogInSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage("");
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
          console.log("Login successful:");
          await redirectToDashboard(data.user.id); // redirect to protected page
        }else{
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