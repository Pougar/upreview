"use client";

import Link from "next/link";
import { checkUserSession } from "@/app/ui/dashboard/AuthGuard";
import { useState, useEffect } from "react";

export default function Settings({ params }: { params: { username: string } }) {
      useEffect(() => {
      const nameCheck = async () => {
          await checkUserSession(params.username);
      }
      nameCheck();
      }, [params.username]);
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 p-6 flex flex-col items-center">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md flex flex-col gap-6">
        <h1 className="text-2xl font-bold text-gray-800 text-center">{params.username} Settings</h1>

        {/* Example Setting 1 */}
        <div className="flex flex-col gap-2">
          <label className="text-gray-700 font-medium">Display Name</label>
          <input
            type="text"
            placeholder="${params.username}"
            className="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
          />
        </div>

        {/* Example Setting 2 */}
        <div className="flex flex-col gap-2">
          <label className="text-gray-700 font-medium">Email Notifications</label>
          <select className="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 transition">
            <option>Enabled</option>
            <option>Disabled</option>
          </select>
        </div>

        {/* Example Setting 3 */}
        <div className="flex items-center justify-between">
          <label className="text-gray-700 font-medium">Dark Mode</label>
          <input type="checkbox" className="w-5 h-5 accent-blue-500"/>
        </div>

        {/* Save Button */}
        <Link
          href="/${params.username}/dashboard"
          className="bg-blue-500 text-white px-6 py-3 rounded-full font-semibold text-center hover:bg-blue-600 transition mt-4"
        >
          Save
        </Link>
      </div>
    </div>
  );
}