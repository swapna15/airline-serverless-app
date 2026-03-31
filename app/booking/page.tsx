"use client";

import { createBooking, getFlightSeats } from "@/lib/api";
import { Booking, Flight, Seat } from "@/lib/types";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

type TravellerDetail = { name: string; email: string };

function SeatButton({ seat, selected, onToggle }: { seat: Seat; selected: boolean; onToggle: (s: Seat) => void }) {
  const base = "w-12 h-12 rounded text-xs font-semibold border-2 transition";
  const colors =
    seat.status === "available"
      ? selected
        ? "bg-blue-500 border-blue-700 text-white cursor-pointer"
        : "bg-green-100 border-green-400 text-green-800 hover:bg-green-200 cursor-pointer"
      : seat.status === "reserved"
      ? "bg-red-100 border-red-300 text-red-400 cursor-not-allowed"
      : "bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed";

  return (
    <button
      type="button"
      disabled={seat.status !== "available"}
      onClick={() => seat.status === "available" && onToggle(seat)}
      className={`${base} ${colors}`}
      title={`${seat.seatNumber} (${seat.status})`}
    >
      {seat.seatNumber}
    </button>
  );
}

function BookingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const flightId = searchParams.get("flightId") ?? "";

  const [flight, setFlight] = useState<Flight | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [selectedSeats, setSelectedSeats] = useState<Seat[]>([]);
  const [travellers, setTravellers] = useState<TravellerDetail[]>([]);
  const [confirmedBooking, setConfirmedBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState("");
  const loadSeats = useCallback(async () => {
    if (!flightId) return;
    try {
      const data = await getFlightSeats(flightId);
      setFlight(data.flight);
      setSeats(data.seats);
    } catch {
      setError("Failed to load flight data.");
    } finally {
      setPageLoading(false);
    }
  }, [flightId]);

  useEffect(() => { loadSeats(); }, [loadSeats]);

  function toggleSeat(seat: Seat) {
    setSelectedSeats((prev) => {
      const exists = prev.find((s) => s.seatNumber === seat.seatNumber);
      if (exists) {
        const next = prev.filter((s) => s.seatNumber !== seat.seatNumber);
        setTravellers((t) => t.slice(0, next.length));
        return next;
      }
      const next = [...prev, seat];
      setTravellers((t) => [...t, { name: "", email: "" }]);
      return next;
    });
  }

  function updateTraveller(index: number, field: keyof TravellerDetail, value: string) {
    setTravellers((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)));
  }

  async function handleBook(e: React.FormEvent) {
    e.preventDefault();
    if (selectedSeats.length === 0) return;
    setLoading(true);
    setError("");
    try {
      const result = await createBooking({
        flightId,
        passengers: selectedSeats.map((seat, i) => ({
          seatNumber: seat.seatNumber,
          passengerName: travellers[i].name,
          passengerEmail: travellers[i].email,
        })),
      });
      setConfirmedBooking(result);
      setSelectedSeats([]);
      setTravellers([]);
      await loadSeats();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "Booking failed. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  if (pageLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!flightId) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 mb-4">No flight selected.</p>
        <Link href="/search" className="text-blue-600 hover:underline text-sm font-medium">← Search for a flight</Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Back navigation */}
      <div className="flex items-center gap-4 mb-4">
        <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-blue-600 transition">← Back</button>
        <Link href="/search" className="text-sm text-gray-500 hover:text-blue-600 transition">Search Flights</Link>
        <Link href="/my-bookings" className="text-sm text-gray-500 hover:text-blue-600 transition">My Bookings</Link>
      </div>

      <h1 className="text-3xl font-bold text-gray-800 mb-2">Book Seats</h1>
      {flight && (
        <p className="text-gray-600 mb-6">
          {flight.from} → {flight.to} &nbsp;·&nbsp; {flight.date} &nbsp;·&nbsp;
          {flight.departureTime} – {flight.arrivalTime} &nbsp;·&nbsp; ${flight.price} per seat
        </p>
      )}

      {/* Confirmation */}
      {confirmedBooking && (
        <div className="bg-green-50 border border-green-300 rounded-xl p-4 mb-6">
          <p className="text-green-800 font-semibold mb-2">
            Booking confirmed — {confirmedBooking.passengers.length} seat{confirmedBooking.passengers.length > 1 ? "s" : ""}!
          </p>
          <p className="text-sm text-green-700 mb-2">
            Booking ID:{" "}
            <Link href={`/my-bookings?id=${confirmedBooking.id}`} className="font-mono font-bold text-blue-700 hover:underline">
              {confirmedBooking.id}
            </Link>
          </p>
          {confirmedBooking.passengers.map((p) => (
            <p key={p.seatNumber} className="text-green-700 text-sm">
              Seat <span className="font-bold">{p.seatNumber}</span> · {p.passengerName}
            </p>
          ))}
          <p className="text-green-600 text-xs mt-2">Click the Booking ID to view full details.</p>
        </div>
      )}

      {error && <p className="text-red-600 mb-4">{error}</p>}

      {/* Legend */}
      <div className="flex gap-4 mb-4 text-xs text-gray-600">
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-green-100 border border-green-400 inline-block" /> Available</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-blue-500 border border-blue-700 inline-block" /> Selected</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-red-100 border border-red-300 inline-block" /> Reserved</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-gray-100 border border-gray-300 inline-block" /> Blocked</span>
      </div>

      {/* Seat map */}
      <div className="bg-white rounded-xl shadow p-5 mb-6">
        <p className="text-sm text-gray-600 mb-3">Click seats to select (multiple allowed)</p>
        <div className="flex flex-wrap gap-2">
          {seats.map((seat) => (
            <SeatButton
              key={seat.seatNumber}
              seat={seat}
              selected={!!selectedSeats.find((s) => s.seatNumber === seat.seatNumber)}
              onToggle={toggleSeat}
            />
          ))}
        </div>
      </div>

      {/* Traveller forms */}
      {selectedSeats.length > 0 && (        <form onSubmit={handleBook} className="flex flex-col gap-4">
          {selectedSeats.map((seat, i) => (
            <div key={seat.seatNumber} className="bg-white rounded-xl shadow p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="bg-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded">Seat {seat.seatNumber}</span>
                <span className="text-sm font-semibold text-gray-700">Traveller {i + 1}</span>
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-600">Full Name</label>
                  <input
                    type="text"
                    required
                    value={travellers[i]?.name ?? ""}
                    onChange={(e) => updateTraveller(i, "name", e.target.value)}
                    placeholder="Full name"
                    className="border rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-600">Email</label>
                  <input
                    type="email"
                    required
                    value={travellers[i]?.email ?? ""}
                    onChange={(e) => updateTraveller(i, "email", e.target.value)}
                    placeholder="email@example.com"
                    className="border rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>
            </div>
          ))}

          <div className="bg-white rounded-xl shadow p-4 flex items-center justify-between">
            <span className="text-sm text-gray-700">
              {selectedSeats.length} seat{selectedSeats.length > 1 ? "s" : ""}
              {flight ? ` · Total $${(flight.price * selectedSeats.length).toFixed(2)}` : ""}
            </span>
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-6 py-2 rounded-lg transition"
            >
              {loading ? "Booking..." : `Confirm ${selectedSeats.length} Seat${selectedSeats.length > 1 ? "s" : ""}`}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function BookingPage() {
  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <Suspense fallback={
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }>
        <BookingContent />
      </Suspense>
    </main>
  );
}
