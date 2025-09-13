"use client";

import Link from "next/link";
import { useUser } from "../UserContext";

export default function DashboardPage() {
    const { name } = useUser();
  return (
        <div className="rounded-2xl min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 p-6 flex flex-col items-center">
            {/* Logo */}
            <div className="w-32 mb-8">
                <img
                src="/snakepic.png"
                alt="Review Remind Logo"
                className="w-full h-full object-contain"
                />
            </div>

            {/* Main Content */}
            <div className="bg-white rounded-2xl shadow-2xl p-10 max-w-4xl w-full flex flex-col items-center gap-6 text-center relative z-10">
                <h1 className="text-3xl font-bold text-gray-800">Welcome to Review Remind {name}!</h1>
                <p className="text-gray-600 text-lg sm:text-xl max-w-2xl">
                Our product helps you increase positive Google reviews for your business by making the review process easier for your clients. 
                Set up a personalized email that we automatically send to your clients after you finish helping them — saving you time and boosting your online reputation.
                </p>

                {/* Optional Call-to-Action buttons */}
                <div className="flex flex-col sm:flex-row gap-4 mt-6">
                <Link
                    href="/dashboard/service"
                    className="bg-blue-500 text-white px-6 py-3 rounded-full hover:bg-blue-600 transition w-full sm:w-auto"
                >
                    Customize Email
                </Link>
                <Link
                    href="/dashboard/statistics"
                    className="border border-gray-300 px-6 py-3 rounded-full hover:bg-gray-100 transition w-full sm:w-auto"
                >
                    View Analytics
                </Link>
                </div>
            </div>
        </div>

  );
}
