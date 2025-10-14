import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <div className="max-w-7xl mx-auto px-6 pt-20 pb-16">
        <div className="text-center">
          {/* Title */}
          <h1 className="text-5xl font-bold text-gray-900 mb-12">UPEO</h1>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/dashboard"
              className="bg-blue-600 text-white px-8 py-4 rounded-lg font-semibold hover:bg-blue-700 transition-all transform hover:scale-105 shadow-lg"
            >
              📈 Stock Analysis
            </Link>
            <Link
              href="/screener"
              className="bg-white text-blue-600 px-8 py-4 rounded-lg font-semibold border-2 border-blue-600 hover:bg-blue-50 transition-all transform hover:scale-105 shadow-lg"
            >
              📊 Stock Screener
            </Link>
            <Link
              href="/fundamentals"
              className="bg-green-600 text-white px-8 py-4 rounded-lg font-semibold hover:bg-green-700 transition-all transform hover:scale-105 shadow-lg"
            >
              📑 Fundamentals
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
