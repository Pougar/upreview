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
        console.log("calling sign up");
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
            
        const { data, error } = await authClient.signUp.email({email, password, name}, {
            onRequest: (ctx) => {
                //show loading
                setLoading(true);
            },
            onSuccess: async (ctx) => {
                //redirect to the dashboard or sign in page
                if (ctx.data?.user?.id) {
                    await fetch("/api/sign-up", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                        id: ctx.data.user.id,
                        name: ctx.data.user.name,
                        email: ctx.data.user.email
                        }),
                    });
                }
                setLoading(false);
                router.push("/dashboard");
            },
            onError: (ctx) => {
                // display the error message
                setLoading(false);
                setError(ctx.error.message);
            },
    });
    }

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
            {password !== password2 && <p className="text-red-500 mb-2">Passwords do not match</p>}

            <form onSubmit={handleSignUpSubmit}>
            <div className="relative bg-white rounded-2xl shadow-2xl w-96 p-10 flex flex-col items-center">
                <h1 className="text-3xl font-bold text-gray-800 mb-6">Sign Up</h1>

                <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Username"
                className="border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-400 focus:outline-none transition"
                />

                <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className="border border-gray-300 rounded-lg px-4 py-2 w-full mt-4 focus:ring-2 focus:ring-blue-400 focus:outline-none transition"
                />

                <h2 className="text-xl font-semibold text-gray-700 mt-6">New Password</h2>
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