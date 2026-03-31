"use client";

import { searchFlights } from "@/lib/api";
import { Flight } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SearchPage() {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [date, setDate] = useState("");
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSearched(false);
    try {
      const results = await searchFlights({
        from: from || undefined,
        to: to || undefined,
        date: date || undefined,
      });
      setFlights(results);
      setSearched(true);
    } catch {
      setError("Failed to search flights. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-800 mb-6">Search Flights</h1>

        <form onSubmit={handleSearch} className="bg-white rounded-xl shadow p-6 mb-8 flex flex-col gap-4">
          <div className="flex gap-4 flex-wrap">
            <div className="flex flex-col flex-1 min-w-[120px]">
              <label className="text-sm font-medium text-gray-600 mb-1">From</label>
              <input
                type="text"
                placeholder="e.g. ORD"
                value={from}
                onChange={(e) => setFrom(e.target.value.toUpperCase())}
                maxLength={3}
                className="border rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div className="flex flex-col flex-1 min-w-[120px]">
              <label className="text-sm font-medium text-gray-600 mb-1">To</label>
              <input
                type="text"
                placeholder="e.g. JFK"
                value={to}
                onChange={(e) => setTo(e.target.value.toUpperCase())}
                maxLength={3}
                className="border rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div className="flex flex-col flex-1 min-w-[160px]">
              <label className="text-sm font-medium text-gray-600 mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="self-start bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-6 py-2 rounded-lg transition"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </form>

        {loading && (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && <p className="text-red-600 mb-4">{error}</p>}

        {!loading && searched && flights.length === 0 && (
          <p className="text-gray-500 text-center py-12">No flights found for your search.</p>
        )}

        {!loading && flights.length > 0 && (
          <div className="flex flex-col gap-4">
            {flights.map((flight) => (
              <div key={flight.id} className="bg-white rounded-xl shadow p-5 flex items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-gray-600 font-mono">{flight.id}</span>
                  <div className="text-lg font-bold text-gray-800">
                    {flight.from} → {flight.to}
                  </div>
                  <div className="text-sm text-gray-500">
                    {flight.date} &nbsp;·&nbsp; {flight.departureTime} – {flight.arrivalTime}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="text-xl font-bold text-blue-600">${flight.price}</span>
                  <span className="text-xs text-gray-600">{flight.availableSeats} seats left</span>
                  <button
                    onClick={() => router.push(`/booking?flightId=${flight.id}`)}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition"
                  >
                    Book
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
