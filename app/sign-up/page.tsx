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
            
        const { data, error } = await authClient.signUp.email({email, password, name}, {
            onRequest: (ctx) => {
                //show loading
                setLoading(true);
            },
            onSuccess: async (ctx) => {
                //redirect to the dashboard or sign in page
                if (data?.user) {
                    await fetch("/api/sign-up", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                        id: data.user.id,
                        name: data.user.name,
                        email: data.user.email
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
        <main className="min-h-screen flex flex-col items-center justify-center gap-2">
            <Link 
                href="/"
                className="absolute top-4 left-4 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 transition"
                >
                Back
            </Link>
            <div className="flex-col flex items-center justify-center">
            {error && <p style={{ color: "red" }}>{error}</p>}
            {password !== password2 && (<p style={{ color: "red" }}>Passwords do not match</p>)}
            <form onSubmit={handleSignUpSubmit}>
                <div className="relative bg-gray-200 dark:bg-gray-700 rounded-lg shadow-lg w-110 h-100 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-6">
                        <h1 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">Sign Up</h1>
                        <input
                        type="text"
                        value={name} // value comes from state
                        onChange={(e) => setName(e.target.value)} // update state on change
                        placeholder="Username"
                        className="border rounded px-3 py-2 w-64"
                        />
                        <input
                        type="email"
                        value={email} // value comes from state
                        onChange={(e) => setEmail(e.target.value)} // update state on change
                        placeholder="Email"
                        className="border rounded px-3 py-2 w-64"
                        />
                        <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100">New Password</h1>
                        <input
                        type="password"
                        value={password} // value comes from state
                        onChange={(e) => setPassword(e.target.value)} // update state on change
                        placeholder="New Password"
                        className="border rounded px-3 py-2 w-64"
                        />
                        <input
                        type="password"
                        value={password2} // value comes from state
                        onChange={(e) => setPassword2(e.target.value)} // update state on change
                        placeholder="New Password Again"
                        className="border rounded px-3 py-2 w-64"
                        />
                        <div className="flex flex-col items-center gap-5">
                            <button
                                onClick={handleSignUpSubmit}
                                disabled={loading || !email || !password || password !== password2}
                                className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-400"
                                >
                                {loading ? "Signing up..." : "Sign up"}
                            </button>
                        </div>
                    </div>
                </div>
            </form>
            </div>
            <Link href="/log-in" className="hover:underline">Already have an account?{" "}Click here to log in</Link>
        </main>
    );
    

}