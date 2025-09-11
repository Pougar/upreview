"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/app/lib/auth-client";

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
    
      if (loading) return <p>Loading review counts...</p>;
      if (error) return <p>Error: {error}</p>;
    

    return (
      <div className="min-h-screen flex flex-col items-center justify-center space-y-6">
        <h1 className="text-2xl font-bold mb-6">Client Reviews</h1>
        <div className="flex space-x-6">
            <button className="px-6 py-3 border-2 border-green-500 text-green-500 rounded-xl hover:bg-green-50 transition">
            Good: {counts?.good}
            </button>
            <button className="px-6 py-3 border-2 border-red-500 text-red-500 rounded-xl hover:bg-red-50 transition">
            Bad: {counts?.bad}
            </button>
            <button className="px-6 py-3 border-2 border-gray-500 text-gray-500 rounded-xl hover:bg-gray-50 transition">
            Not Reviewed Yet: {counts?.not_reviewed_yet}
            </button>
        </div>
    </div>
    );
  }
  