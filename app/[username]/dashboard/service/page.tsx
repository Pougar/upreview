"use client";

import Link from "next/link";
import { checkUserSession } from "@/app/ui/dashboard/AuthGuard";
import { useEffect, useState } from "react";

export default function Service({ params }: { params: { username: string } }) {
    useEffect(() => {
    const nameCheck = async () => {
        await checkUserSession(params.username);
    }
    nameCheck();
    }, [params.username]);
    return(
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 p-6 flex flex-col items-center">
    {/* Card container */}
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl p-6 flex flex-col gap-6">
        
        {/* Header (like Gmail) */}
        <div className="flex items-center justify-between border-b border-gray-200 pb-4">
        <h1 className="text-xl font-semibold text-gray-800">Edit Automated Email</h1>
        <button className="bg-blue-500 text-white px-4 py-2 rounded-full hover:bg-blue-600 transition">
            Save Changes
        </button>
        </div>

        {/* Subject Input */}
        <div className="flex flex-col gap-2">
        <label className="font-medium text-gray-700">Subject</label>
        <input 
            type="text" 
            placeholder="We loved helping you! Leave a review"
            className="border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-400 focus:outline-none transition"
        />
        </div>

        {/* Email Body */}
        <div className="flex flex-col gap-2">
        <label className="font-medium text-gray-700">Email Body</label>
        <textarea
            rows={10}
            placeholder="Hi [Client Name],&#10;&#10;We hope you enjoyed our service! Please leave us a Google review to let others know about your experience."
            className="border border-gray-300 rounded-lg px-4 py-3 w-full focus:ring-2 focus:ring-blue-400 focus:outline-none transition resize-none font-sans text-gray-800"
        ></textarea>
        </div>

        {/* Footer example with signature */}
        <div className="text-gray-500 text-sm">
        <p>Best regards,</p>
        <p>Your Company Name</p>
        </div>
    </div>
    </div>
    );

}