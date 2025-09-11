"use client";

import Link from "next/link";

export default function Service() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p>Payment details and option to change payment plan here</p>
        <Link href="/dashboard">Go to Dashboard</Link>
    </div>
  );
}