
import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-100 via-blue-100 to-pink-100 p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-10 flex flex-col items-center gap-8 w-full max-w-lg text-center">
        
        {/* Logo Placeholder */}
        <div className="w-32 h-32">
          <img 
            src="/snakepic.png" 
            alt="Review Remind Logo" 
            className="w-full h-full object-contain"
          />
        </div>

        {/* Heading */}
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">
          Review Remind
        </h1>
        <p className="text-gray-600 sm:text-lg">
          Increase positive Google reviews for your business effortlessly
        </p>

        {/* Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
          <Link
            href="/log-in"
            className="w-full sm:w-auto bg-blue-500 text-white rounded-full px-6 py-3 font-medium hover:bg-blue-600 transition"
          >
            Log In
          </Link>
          <Link
            href="/choose-plan"
            className="w-full sm:w-auto border border-gray-300 rounded-full px-6 py-3 font-medium hover:bg-gray-100 transition"
          >
            Sign Up
          </Link>
        </div>
      </div>
    </div>

  );
}
