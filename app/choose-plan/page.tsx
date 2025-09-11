"use client";

import Link from "next/link";

export default function ChoosePlan() {
  return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 p-6 flex flex-col items-center gap-10">
        <h1 className="text-3xl font-bold text-gray-800 text-center">Choose Your Plan</h1>
        <p className="text-gray-600 text-center max-w-xl">
            Select a plan that works for you. After choosing a plan, create your account and start boosting your Google reviews!
        </p>

        {/* Plan Cards */}
        <div className="flex flex-col sm:flex-row gap-6 mt-6">
            
            {/* Basic Plan */}
            <Link 
            href="/sign-up"
            className="bg-white rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-4 w-72 hover:shadow-3xl transition"
            >
            <h2 className="text-xl font-bold text-gray-800">Basic</h2>
            <p className="text-2xl font-semibold text-gray-700">$50 / month</p>
            <ul className="text-gray-600 text-left mt-4 flex flex-col gap-2">
                <li>✔ Automatic review emails</li>
                <li>✔ Simple email customization</li>
                <li>✖ Advanced analytics</li>
                <li>✖ Priority support</li>
            </ul>
            </Link>

            {/* Premium Plan */}
            <Link 
            href="/sign-up"
            className="bg-white rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-4 w-72 hover:shadow-3xl transition"
            >
            <h2 className="text-xl font-bold text-gray-800">Premium</h2>
            <p className="text-2xl font-semibold text-gray-700">$150 / month</p>
            <ul className="text-gray-600 text-left mt-4 flex flex-col gap-2">
                <li>✔ Automatic review emails</li>
                <li>✔ Custom email templates</li>
                <li>✔ Advanced analytics</li>
                <li>✖ Priority support</li>
            </ul>
            </Link>

            {/* VIP Plan */}
            <Link 
            href="/sign-up"
            className="bg-white rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-4 w-72 hover:shadow-3xl transition"
            >
            <h2 className="text-xl font-bold text-gray-800">VIP</h2>
            <p className="text-2xl font-semibold text-gray-700">$300 / month</p>
            <ul className="text-gray-600 text-left mt-4 flex flex-col gap-2">
                <li>✔ Automatic review emails</li>
                <li>✔ Custom email templates</li>
                <li>✔ Advanced analytics</li>
                <li>✔ Priority support</li>
            </ul>
            </Link>

        </div>
        </div>

  );
}