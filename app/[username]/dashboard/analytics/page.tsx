"use client";

import { useEffect, useMemo, useState } from "react";
import { useUser } from "../../UserContext";
import { authClient } from "@/app/lib/auth-client";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

type ReviewCounts = {
  good: number;
  bad: number;
  not_reviewed_yet: number;
};

type Slice = {
  name: "Good" | "Bad" | "Unreviewed";
  value: number;
  key: "good" | "bad" | "unreviewed";
};

export default function Stats() {
  const { name, display } = useUser();
  const { data: session, isPending } = authClient.useSession();

  const [counts, setCounts] = useState<ReviewCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (isPending) return;
      if (!session?.user?.id) {
        setLoading(false);
        setError("You're not signed in.");
        return;
      }
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/statistics", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: session.user.id }),
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Failed to fetch review counts");
        const data: ReviewCounts = await res.json();
        if (alive) setCounts(data);
      } catch (e: any) {
        if (alive) setError(e?.message || "Failed to load statistics");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [session, isPending]);

  const total = useMemo(
    () => (!counts ? 0 : (counts.good || 0) + (counts.bad || 0) + (counts.not_reviewed_yet || 0)),
    [counts]
  );

  const data: Slice[] = useMemo(
    () => [
      { name: "Good", value: counts?.good ?? 0, key: "good" },
      { name: "Bad", value: counts?.bad ?? 0, key: "bad" },
      { name: "Unreviewed", value: counts?.not_reviewed_yet ?? 0, key: "unreviewed" },
    ],
    [counts]
  );

  const COLORS: Record<Slice["key"], string> = {
    good: "#16a34a", // green
    bad: "#dc2626", // red
    unreviewed: "#6b7280", // gray
  };

  // typed label renderer (prevents implicit any)
  const renderLabel = (slice: { name: string; value: number }) => `${slice.name}: ${slice.value}`;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-64 w-64 rounded-2xl bg-gray-100 animate-pulse" />
      </div>
    );
  }

  if (error) {
    return <div className="min-h-screen flex items-center justify-center text-red-600">{error}</div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5">
        <h1 className="text-2xl font-bold text-gray-800 text-center">
          {display ? `${display} analytics` : "Analytics"}
        </h1>

        {total === 0 ? (
          <div className="mt-6 flex h-96 items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-gray-500">
            No reviews yet.
          </div>
        ) : (
          <>
            <div className="mt-4 h-96 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={120}
                    paddingAngle={2}
                    label={renderLabel}
                  >
                    {data.map((entry) => (
                      <Cell key={entry.key} fill={COLORS[entry.key]} />
                    ))}
                  </Pie>
                  {/* Tooltip removed to disable hover popup */}
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* simple custom legend */}
            <div className="mt-4 flex items-center justify-center gap-6">
              {data.map((d) => (
                <div key={d.key} className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: COLORS[d.key] }} />
                  <span>
                    {d.name} ({d.value})
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
