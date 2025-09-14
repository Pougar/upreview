"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/app/lib/auth-client";
import Link from "next/link";
import Image from "next/image";
import { checkUserSession } from "@/app/ui/dashboard/AuthGuard";


type ReviewCounts = {
    good: number;
    bad: number;
    not_reviewed_yet: number;
  };

export default function Stats({ params }: { params: { username: string } }) {

    useEffect(() => {
    const nameCheck = async () => {
        await checkUserSession(params.username);
    }
    nameCheck();
    }, [params.username]);

    const { data: session, isPending } = authClient.useSession();
    const [counts, setCounts] = useState<ReviewCounts | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

      useEffect(() => {
        async function fetchCountsForUser() {
            if (session) {
                try{
                    const res = await fetch("/api/statistics", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ userId: session.user.id }),
                    });
                    if (!res.ok) throw new Error("Failed to fetch review counts");
                    const data: ReviewCounts = await res.json();
                    setCounts(data);
                }catch (err) {
                    if (err instanceof Error) {
                        setError(err.message);
                    } else {
                        setError(String(err));
                    }
                } finally {
                    setLoading(false);
                }
            }else if (!isPending) {
                // If no session and not still checking → stop loading
                setLoading(false);
            }
        }
        fetchCountsForUser();
    }, [session, isPending]);
    
      if (loading) return <p className="text-center">Loading review counts...</p>;
      if (error) return <p>Error: {error}</p>;
    

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 p-6 flex flex-col items-center gap-10">
        <h1 className="text-3xl font-bold text-gray-800 text-center">Review Dashboard</h1>
        <p className="text-gray-600 text-center max-w-xl">
            Track your reviews and see how your business is performing.
        </p>

        {/* Buttons Section */}
        <div className="flex flex-col sm:flex-row gap-6 w-full justify-center">

            {/* Good Reviews */}
            <Link
            href="/${params.username}/dashboard/statistics/good-reviews"
            className="bg-green-200 text-green-800 rounded-2xl p-6 flex flex-col items-center justify-between gap-4 hover:bg-green-300 transition w-72 h-72 shadow-md inline-flex"
            >
            <div className="text-center">
                <h2 className="text-3xl font-bold">{counts?.good}</h2>
                <p className="text-lg font-medium">Good Reviews</p>
            </div>
            <div className="bg-white w-32 h-32 rounded-lg relative">
                <Image src="/goodgraph.png" alt="Good Reviews Graph" fill className="object-contain" />
            </div>
            </Link>

            {/* Bad Reviews */}
            <Link
            href="/dashboard/statistics/bad-reviews"
            className="bg-red-200 text-red-800 rounded-2xl p-6 flex flex-col items-center justify-between gap-4 hover:bg-red-300 transition w-72 h-72 shadow-md inline-flex"
            >
            <div className="text-center">
                <h2 className="text-3xl font-bold">{counts?.bad}</h2>
                <p className="text-lg font-medium">Bad Reviews</p>
            </div>
            <div className="bg-white w-32 h-32 rounded-lg relative">
                <Image src="/snakepic.png" alt="Bad Reviews Graph" fill className="object-contain" />
            </div>
            </Link>

            {/* Not Reviewed Yet */}
            <Link
            href="/dashboard/statistics/not-reviewed"
            className="bg-gray-200 text-gray-800 rounded-2xl p-6 flex flex-col items-center justify-between gap-4 hover:bg-gray-300 transition w-72 h-72 shadow-md inline-flex"
            >
            <div className="text-center">
                <h2 className="text-3xl font-bold">{counts?.not_reviewed_yet}</h2>
                <p className="text-lg font-medium">Not Reviewed Yet</p>
            </div>
            <div className="bg-white w-32 h-32 rounded-lg relative">
                <Image src="/snakepic.png" alt="Not Reviewed Graph" fill className="object-contain" />
            </div>
            </Link>

        </div>
        </div>
    );
  }
  