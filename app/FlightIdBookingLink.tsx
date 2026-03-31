"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function FlightIdBookingLink() {
  const router = useRouter();
  const [flightId, setFlightId] = useState("");
  const [open, setOpen] = useState(false);

  function handleGo(e: React.FormEvent) {
    e.preventDefault();
    const id = flightId.trim().toUpperCase();
    if (id) router.push(`/booking?flightId=${id}`);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded border p-4 text-gray-800 font-medium hover:bg-gray-50 transition text-left"
      >
        Booking + Seating
      </button>
    );
  }

  return (
    <form onSubmit={handleGo} className="rounded border p-4 flex flex-col gap-2">
      <span className="text-sm font-medium text-gray-700">Enter Flight ID</span>
      <input
        autoFocus
        type="text"
        placeholder="e.g. FL-1001"
        value={flightId}
        onChange={(e) => setFlightId(e.target.value)}
        className="border rounded px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded transition"
        >
          Go
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setFlightId(""); }}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
