"use client";

import { getBooking, getMyBookings } from "@/lib/api";
import { Booking } from "@/lib/types";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function BookingCard({ booking }: { booking: Booking }) {
  return (
    <div className="bg-white rounded-xl shadow p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-mono font-bold text-gray-800">{booking.id}</span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
          booking.status === "confirmed" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
        }`}>
          {booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
        </span>
      </div>
      <div className="text-sm text-gray-600">
        <span className="font-medium text-gray-800">{booking.flightId}</span>
        &nbsp;·&nbsp;{new Date(booking.createdAt).toLocaleDateString()}
      </div>
      {booking.passengers?.length > 0 && (
        <div className="flex flex-col gap-1">
          {booking.passengers.map((p) => (
            <div key={p.seatNumber} className="flex items-center gap-2 text-sm">
              <span className="bg-blue-100 text-blue-700 font-bold text-xs px-2 py-0.5 rounded">
                {p.seatNumber}
              </span>
              <span className="text-gray-700">{p.passengerName}</span>
              <span className="text-gray-400">·</span>
              <span className="text-gray-500">{p.passengerEmail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MyBookingsContent() {
  const searchParams = useSearchParams();

  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [lookupId, setLookupId] = useState(searchParams.get("id") ?? "");
  const [lookedUpBooking, setLookedUpBooking] = useState<Booking | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");

  // Load all bookings — the API returns 401 if not logged in
  useEffect(() => {
    setLoadingAll(true);
    getMyBookings()
      .then((data) => {
        setMyBookings(data);
        setIsLoggedIn(true);
      })
      .catch((err) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        setIsLoggedIn(status === 401 ? false : true);
      })
      .finally(() => setLoadingAll(false));
  }, []);

  // Auto-lookup if ID in query string
  useEffect(() => {
    const id = searchParams.get("id");
    if (id) lookup(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function lookup(id: string) {
    const trimmed = id.trim().toUpperCase();
    if (!trimmed) return;
    setLookupLoading(true);
    setLookupError("");
    setLookedUpBooking(null);
    try {
      const result = await getBooking(trimmed);
      setLookedUpBooking(result);
    } catch (err: unknown) {
      const s = (err as { response?: { status?: number } })?.response?.status;
      setLookupError(s === 404 ? `No booking found for "${trimmed}".` : "Failed to retrieve booking.");
    } finally {
      setLookupLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-800 mb-2">My Bookings</h1>

      {/* Lookup by ID */}
      <div className="bg-white rounded-xl shadow p-5 mb-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Look up a booking by ID</h2>
        <form
          onSubmit={(e) => { e.preventDefault(); lookup(lookupId); }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            placeholder="e.g. BK-A1B2C3D4"
            className="border rounded-lg px-3 py-2 text-sm text-gray-800 flex-1 focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
          />
          <button
            type="submit"
            disabled={lookupLoading}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
          >
            {lookupLoading ? "..." : "Find"}
          </button>
        </form>
        {lookupError && <p className="text-red-600 text-sm mt-2">{lookupError}</p>}
        {lookedUpBooking && (
          <div className="mt-4">
            <BookingCard booking={lookedUpBooking} />
          </div>
        )}
      </div>

      {/* User's own bookings */}
      {loadingAll && (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loadingAll && isLoggedIn === false && (
        <div className="text-center py-8 text-gray-500 text-sm">
          <Link href="/login" className="text-blue-600 hover:underline font-medium">Sign in</Link> to see your bookings.
        </div>
      )}

      {!loadingAll && isLoggedIn === true && (
        <>
          <h2 className="text-lg font-bold text-gray-800 mb-4">Your Bookings</h2>
          {myBookings.length === 0 ? (
            <div className="text-center py-10 text-gray-500 text-sm">
              No bookings yet.{" "}
              <Link href="/search" className="text-blue-600 hover:underline">Search for a flight</Link> to get started.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {myBookings.map((b) => <BookingCard key={b.id} booking={b} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function MyBookingsPage() {
  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <Suspense fallback={
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }>
        <MyBookingsContent />
      </Suspense>
    </main>
  );
}
