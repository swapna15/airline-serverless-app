"use client";

import { cancelFlight, rescheduleFlight, searchFlights, updateSeat } from "@/lib/api";
import { Flight, Seat, SeatStatus } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function ManagePage() {
  const router = useRouter();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loadingFlights, setLoadingFlights] = useState(true);
  const [flightsError, setFlightsError] = useState("");

  // Reschedule form
  const [rescheduleId, setRescheduleId] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleDep, setRescheduleDep] = useState("");
  const [rescheduleArr, setRescheduleArr] = useState("");
  const [rescheduleMsg, setRescheduleMsg] = useState("");
  const [rescheduleError, setRescheduleError] = useState("");
  const [rescheduleLoading, setRescheduleLoading] = useState(false);

  // Cancel form
  const [cancelId, setCancelId] = useState("");
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelMsg, setCancelMsg] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [cancelLoading, setCancelLoading] = useState(false);

  // Seat update form
  const [seatFlightId, setSeatFlightId] = useState("");
  const [seatNumber, setSeatNumber] = useState("");
  const [seatStatus, setSeatStatus] = useState<SeatStatus>("available");
  const [seatMsg, setSeatMsg] = useState("");
  const [seatError, setSeatError] = useState("");
  const [seatLoading, setSeatLoading] = useState(false);

  async function loadFlights() {
    setLoadingFlights(true);
    setFlightsError("");
    try {
      const data = await searchFlights({});
      setFlights(data);
    } catch {
      setFlightsError("Failed to load flights.");
    } finally {
      setLoadingFlights(false);
    }
  }

  useEffect(() => {
    loadFlights();
  }, []);

  async function handleReschedule(e: React.FormEvent) {
    e.preventDefault();
    setRescheduleMsg("");
    setRescheduleError("");
    setRescheduleLoading(true);
    try {
      const updated = await rescheduleFlight(rescheduleId, {
        date: rescheduleDate,
        departureTime: rescheduleDep,
        arrivalTime: rescheduleArr,
      });
      setRescheduleMsg(
        `Flight ${updated.id} rescheduled to ${updated.date} ${updated.departureTime}–${updated.arrivalTime}`
      );
      await loadFlights();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "Reschedule failed.";
      setRescheduleError(msg);
    } finally {
      setRescheduleLoading(false);
    }
  }

  async function handleCancel(e: React.FormEvent) {
    e.preventDefault();
    if (!cancelConfirm) {
      setCancelConfirm(true);
      return;
    }
    setCancelMsg("");
    setCancelError("");
    setCancelLoading(true);
    try {
      const updated = await cancelFlight(cancelId);
      setCancelMsg(`Flight ${updated.id} has been cancelled.`);
      setCancelConfirm(false);
      await loadFlights();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "Cancellation failed.";
      setCancelError(msg);
      setCancelConfirm(false);
    } finally {
      setCancelLoading(false);
    }
  }

  async function handleSeatUpdate(e: React.FormEvent) {
    e.preventDefault();
    setSeatMsg("");
    setSeatError("");
    setSeatLoading(true);
    try {
      const updated: Seat = await updateSeat(seatFlightId, seatNumber, seatStatus);
      setSeatMsg(`Seat ${updated.seatNumber} updated to "${updated.status}".`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "Seat update failed.";
      setSeatError(msg);
    } finally {
      setSeatLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto flex flex-col gap-8">
        <h1 className="text-3xl font-bold text-gray-800">Flight Management</h1>

        {/* Flight list */}
        <section className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-700">All Flights</h2>
            <button
              onClick={loadFlights}
              className="text-sm text-blue-600 hover:underline"
            >
              Refresh
            </button>
          </div>
          {loadingFlights ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : flightsError ? (
            <p className="text-red-600 text-sm">{flightsError}</p>
          ) : flights.length === 0 ? (
            <p className="text-gray-400 text-sm">No flights found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="text-gray-700 border-b">
                    <th className="py-2 pr-4 font-semibold">ID</th>
                    <th className="py-2 pr-4 font-semibold">Route</th>
                    <th className="py-2 pr-4 font-semibold">Date</th>
                    <th className="py-2 pr-4 font-semibold">Departure</th>
                    <th className="py-2 pr-4 font-semibold">Arrival</th>
                    <th className="py-2 pr-4 font-semibold">Seats</th>
                    <th className="py-2 font-semibold">Status</th>
                    <th className="py-2 pl-4 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {flights.map((f) => (
                    <tr key={f.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-2 pr-4 font-mono text-xs text-gray-800">{f.id}</td>
                      <td className="py-2 pr-4 font-semibold text-gray-800">{f.from} → {f.to}</td>
                      <td className="py-2 pr-4 text-gray-700">{f.date}</td>
                      <td className="py-2 pr-4 text-gray-700">{f.departureTime}</td>
                      <td className="py-2 pr-4 text-gray-700">{f.arrivalTime}</td>
                      <td className="py-2 pr-4 text-gray-700">{f.availableSeats}/{f.totalSeats}</td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          f.status === "cancelled"
                            ? "bg-red-100 text-red-700"
                            : "bg-green-100 text-green-700"
                        }`}>
                          {f.status ?? "active"}
                        </span>
                      </td>
                      <td className="py-2 pl-4">
                        <button
                          onClick={() => router.push(`/booking?flightId=${f.id}`)}
                          disabled={f.status === "cancelled"}
                          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-1 rounded transition"
                        >
                          Book
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Reschedule */}
        <section className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">Reschedule Flight</h2>
          <form onSubmit={handleReschedule} className="flex flex-col gap-3">
            <div className="flex gap-3 flex-wrap">
              <input
                required
                placeholder="Flight ID (e.g. FL-1001)"
                value={rescheduleId}
                onChange={(e) => setRescheduleId(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[140px] focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <input
                required
                type="date"
                value={rescheduleDate}
                onChange={(e) => setRescheduleDate(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[140px] focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <input
                required
                type="time"
                value={rescheduleDep}
                onChange={(e) => setRescheduleDep(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[120px] focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <input
                required
                type="time"
                value={rescheduleArr}
                onChange={(e) => setRescheduleArr(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[120px] focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <button
              type="submit"
              disabled={rescheduleLoading}
              className="self-start bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition"
            >
              {rescheduleLoading ? "Saving..." : "Reschedule"}
            </button>
            {rescheduleMsg && <p className="text-green-700 text-sm">{rescheduleMsg}</p>}
            {rescheduleError && <p className="text-red-600 text-sm">{rescheduleError}</p>}
          </form>
        </section>

        {/* Cancel */}
        <section className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">Cancel Flight</h2>
          <form onSubmit={handleCancel} className="flex flex-col gap-3">
            <input
              required
              placeholder="Flight ID (e.g. FL-1001)"
              value={cancelId}
              onChange={(e) => { setCancelId(e.target.value); setCancelConfirm(false); }}
              className="border rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-red-400"
            />
            {cancelConfirm && (
              <p className="text-amber-700 text-sm font-medium">
                Are you sure you want to cancel flight <strong>{cancelId}</strong>? Click Cancel Flight again to confirm.
              </p>
            )}
            <button
              type="submit"
              disabled={cancelLoading}
              className="self-start bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition"
            >
              {cancelLoading ? "Cancelling..." : cancelConfirm ? "Confirm Cancellation" : "Cancel Flight"}
            </button>
            {cancelMsg && <p className="text-green-700 text-sm">{cancelMsg}</p>}
            {cancelError && <p className="text-red-600 text-sm">{cancelError}</p>}
          </form>
        </section>

        {/* Seat update */}
        <section className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">Update Seat Status</h2>
          <form onSubmit={handleSeatUpdate} className="flex flex-col gap-3">
            <div className="flex gap-3 flex-wrap">
              <input
                required
                placeholder="Flight ID (e.g. FL-1001)"
                value={seatFlightId}
                onChange={(e) => setSeatFlightId(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[140px] focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <input
                required
                placeholder="Seat (e.g. 2C)"
                value={seatNumber}
                onChange={(e) => setSeatNumber(e.target.value.toUpperCase())}
                className="border rounded-lg px-3 py-2 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <select
                value={seatStatus}
                onChange={(e) => setSeatStatus(e.target.value as SeatStatus)}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="available">Available</option>
                <option value="reserved">Reserved</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={seatLoading}
              className="self-start bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition"
            >
              {seatLoading ? "Updating..." : "Update Seat"}
            </button>
            {seatMsg && <p className="text-green-700 text-sm">{seatMsg}</p>}
            {seatError && <p className="text-red-600 text-sm">{seatError}</p>}
          </form>
        </section>
      </div>
    </main>
  );
}
