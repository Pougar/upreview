"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/app/lib/auth-client";
import Link from "next/link";
import Image from "next/image";


type ReviewCounts = {
    good: number;
    bad: number;
    not_reviewed_yet: number;
  };

export default function Stats() {

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
    
      if (loading) return <p className="flex">Loading review counts...</p>;
      if (error) return <p>Error: {error}</p>;
    

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 p-6 flex flex-col items-center gap-10">
        <h1 className="text-3xl font-bold text-gray-800 text-center">Review Dashboard</h1>
        <p className="text-gray-600 text-center max-w-xl">
            Track your reviews and see how your business is performing.
        </p>

        {/* Buttons Section */}
        <div className="flex flex-col sm:flex-row gap-6 w-full justify-center">
            
            {/* Good Reviews Button */}
            <button className="bg-green-500 text-white rounded-2xl p-8 flex flex-col items-center justify-center gap-4 hover:bg-green-600 transition w-72 h-72 shadow-2xl">
            <h2 className="text-xl font-bold">Good Reviews</h2>
            <p className="text-gray-100">Click to see details</p>
            {/* Placeholder for graph */}
            <div className="bg-white w-40 h-40 rounded-lg flex items-center justify-center">
                <span className="text-gray-400">Graph Here</span>
            </div>
            </button>

            {/* Average Reviews Button */}
            <button className="bg-yellow-400 text-white rounded-2xl p-8 flex flex-col items-center justify-center gap-4 hover:bg-yellow-500 transition w-72 h-72 shadow-2xl">
            <h2 className="text-xl font-bold">Average Reviews</h2>
            <p className="text-gray-100">Click to see details</p>
            {/* Optional placeholder */}
            <div className="bg-white w-40 h-40 rounded-lg flex items-center justify-center">
                <Image src="/goodgraph.png" alt="Average Reviews Graph" width={100} height={100} className="text-gray-400" />
            </div>
            </button>

            {/* Poor Reviews Button */}
            <button className="bg-red-500 text-white rounded-2xl p-8 flex flex-col items-center justify-center gap-4 hover:bg-red-600 transition w-72 h-72 shadow-2xl">
            <h2 className="text-xl font-bold">Poor Reviews</h2>
            <p className="text-gray-100">Click to see details</p>
            {/* Optional placeholder */}
            <div className="bg-white w-40 h-40 rounded-lg flex items-center justify-center">
                <span className="text-gray-400">Graph Here</span>
            </div>
            </button>

        </div>
        </div>

    );
  }
  