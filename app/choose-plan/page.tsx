"use client";

import Link from "next/link";

export default function ChoosePlan() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
    <p>Users choose plan here. Plan choice takes user to sign up screen and then after sign up they pay for plan</p>
    <Link href="/sign-up">Go to Sign Up</Link>
    </div>
  );
}