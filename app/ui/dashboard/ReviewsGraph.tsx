"use client";

import { useEffect, useMemo, useState } from "react";
import * as Recharts from "recharts";

type ApiPoint = [dateISO: string, good: number, bad: number];

type Props = {
  userId: string | null;
  months?: number; // default 12
};

type Monthly = {
  monthKey: string; // "YYYY-MM"
  label: string;    // "Jan 2025"
  total: number;
  x: number;        // numeric index for axis domain control
  // (good/bad are aggregated internally but not plotted)
};

export default function ReviewsGraph({ userId, months = 12 }: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [raw, setRaw] = useState<ApiPoint[]>([]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch("/api/analytics/get-graph-info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Graph info error ${res.status}`);
        const data = await res.json();
        if (!alive) return;
        const points: ApiPoint[] = Array.isArray(data?.points) ? data.points : [];
        setRaw(points);
      } catch (e: any) {
        if (alive) setErr(e?.message || "Failed to load review trends.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [userId]);

  const data: Monthly[] = useMemo(() => {
    const now = new Date();
    const bins: Record<string, { label: string; good: number; bad: number }> = {};
    const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const monthLabel = (d: Date) =>
      d.toLocaleString(undefined, { month: "short", year: "numeric" });

    // Seed month bins
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      d.setUTCMonth(d.getUTCMonth() - i);
      const key = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
      bins[key] = { label: monthLabel(d), good: 0, bad: 0 };
    }

    // Aggregate daily → monthly (UTC)
    for (const [iso, good, bad] of raw) {
      const d = new Date(`${iso}T00:00:00Z`);
      const key = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
      if (!bins[key]) continue;
      bins[key].good += good || 0;
      bins[key].bad += bad || 0;
    }

    // Build ordered array and attach numeric x index
    const ordered = Object.entries(bins)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, v], idx) => ({
        monthKey: "", // not needed externally
        label: v.label,
        total: v.good + v.bad,
        x: idx,
      }));

    return ordered;
  }, [raw, months]);

  if (!userId) return <div className="text-sm text-gray-600">Sign in to see your monthly review trends.</div>;
  if (loading) return <div className="h-72 w-full rounded bg-gray-100" />;
  if (err) return <div className="text-sm text-amber-800">{err}</div>;
  if (data.length === 0 || data.every(d => d.total === 0))
    return <div className="text-sm text-gray-600">No reviews yet for the selected period.</div>;

  // --- Style and axes ---
  const axis = "#6b7280"; // gray-500
  const grid = "#e5e7eb"; // gray-200

  // Y: extend above peak for headroom (≥25% or round up to multiple of 4)
  const maxTotal = Math.max(...data.map(d => d.total));
  const yTarget = Math.ceil(maxTotal * 1.25);
  const yMax = Math.max(maxTotal + 1, Math.ceil(yTarget / 4) * 4); // e.g., 12 → 16

  // X: numeric domain with a little extra room to the right for "growth"
  const endIndex = data.length - 1;
  const xDomain: [number, number] = [0, endIndex + 0.4]; // extend 40% of one bin to the right

  // Show only start & end month labels
  const startLabel = data[0]?.label ?? "";
  const endLabel = data[endIndex]?.label ?? "";
  const ticks = data.length > 1 ? [0, endIndex] : [0];
  const tickFormatter = (x: number) => (x === 0 ? startLabel : x === endIndex ? endLabel : "");

  return (
    // Integrated (no card or background)
    <div className="w-full">
      <div className="h-72 sm:h-80 w-full">
        <Recharts.ResponsiveContainer width="100%" height="100%">
          <Recharts.ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            {/* subtle grid */}
            <Recharts.CartesianGrid stroke={grid} vertical={false} />

            {/* numeric X axis so we can extend domain to the right */}
            <Recharts.XAxis
              type="number"
              dataKey="x"
              domain={xDomain}
              ticks={ticks}
              tickFormatter={tickFormatter}
              tick={{ fill: axis, fontSize: 12 }}
              tickMargin={8}
              axisLine={{ stroke: grid }}
              tickLine={false}
            />

            <Recharts.YAxis
              allowDecimals={false}
              domain={[0, yMax]}
              tick={{ fill: axis, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickMargin={12} 
            />

            {/* No tooltip/legend/active dots to avoid hover visuals */}
            <defs>
              <linearGradient id="totalArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#000000" stopOpacity={0.10} />
                <stop offset="100%" stopColor="#000000" stopOpacity={0.05} />
              </linearGradient>
            </defs>

            {/* soft shadow under the line */}
            <Recharts.Area
              type="monotone"
              dataKey="total"
              stroke="none"
              fill="url(#totalArea)"
              isAnimationActive
            />

            {/* clean black line for total */}
            <Recharts.Line
              dataKey="total"
              type="monotone"
              stroke="#000000"
              strokeWidth={2}
              dot={false}
              activeDot={false}
              isAnimationActive
            />
          </Recharts.ComposedChart>
        </Recharts.ResponsiveContainer>
      </div>
    </div>
  );
}
