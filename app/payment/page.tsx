"use client";

import Link from "next/link";

export default function Service() {
  return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 p-6 flex flex-col items-center">
        <div className="bg-white rounded-2xl shadow-2xl p-10 flex flex-col gap-6 w-full max-w-md">
            
            {/* Heading */}
            <h1 className="text-3xl font-bold text-gray-800 text-center">Complete Your Payment</h1>
            <p className="text-gray-600 text-center">
            Enter your payment details to activate your plan. You can also change your plan below.
            </p>

            {/* Plan Selection */}
            <div className="flex justify-between gap-4 mt-4">
            <button className="flex-1 border rounded-2xl py-3 font-semibold text-gray-800 hover:border-black transition">
                Basic
            </button>
            <button className="flex-1 border rounded-2xl py-3 font-semibold text-gray-800 hover:border-black transition">
                Premium
            </button>
            <button className="flex-1 border-2 border-black rounded-2xl py-3 font-semibold text-gray-800 bg-yellow-100">
                VIP
            </button>
            </div>

            {/* Payment Method */}
            <div className="flex flex-col gap-3 mt-4">
            <label className="text-gray-700 font-medium">Payment Method</label>
            <select className="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-400 focus:outline-none transition">
                <option>Credit Card</option>
                <option>PayPal</option>
                <option>Apple Pay</option>
            </select>
            </div>

            {/* Payment Details */}
            <div className="flex flex-col gap-3 mt-4">
            <label className="text-gray-700 font-medium">Cardholder Name</label>
            <input type="text" placeholder="John Doe" className="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-400 focus:outline-none transition"/>
            
            <label className="text-gray-700 font-medium">Card Number</label>
            <input type="text" placeholder="1234 5678 9012 3456" className="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-400 focus:outline-none transition"/>
            
            <div className="flex gap-4">
                <div className="flex-1">
                <label className="text-gray-700 font-medium">Expiry</label>
                <input type="text" placeholder="MM/YY" className="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-400 focus:outline-none transition"/>
                </div>
                <div className="flex-1">
                <label className="text-gray-700 font-medium">CVV</label>
                <input type="text" placeholder="123" className="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-400 focus:outline-none transition"/>
                </div>
            </div>
            </div>

            {/* Complete Payment Button */}
            <button className="bg-blue-500 text-white px-6 py-3 rounded-full font-semibold hover:bg-blue-600 transition mt-6 w-full">
            Complete Payment
            </button>

        </div>
        </div>

  );
}