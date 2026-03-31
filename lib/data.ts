import { Booking, Flight, Seat, SeatStatus } from "@/lib/types";

const rowLabels = ["A", "B", "C", "D", "E", "F"];

const initialFlights: Flight[] = [
  {
    id: "FL-1001",
    from: "ORD",
    to: "JFK",
    date: "2026-04-10",
    departureTime: "08:30",
    arrivalTime: "11:20",
    price: 220,
    totalSeats: 24,
    availableSeats: 24,
  },
  {
    id: "FL-1002",
    from: "SFO",
    to: "LAX",
    date: "2026-04-10",
    departureTime: "09:00",
    arrivalTime: "10:35",
    price: 140,
    totalSeats: 24,
    availableSeats: 24,
  },
  {
    id: "FL-1003",
    from: "SEA",
    to: "DEN",
    date: "2026-04-11",
    departureTime: "14:15",
    arrivalTime: "17:05",
    price: 180,
    totalSeats: 24,
    availableSeats: 24,
  },
];

const flights = new Map<string, Flight>(initialFlights.map((f) => [f.id, f]));
const seatMaps = new Map<string, Seat[]>();
const bookings = new Map<string, Booking>();

function createSeatMap(seatsCount: number): Seat[] {
  const seatMap: Seat[] = [];
  const rows = Math.ceil(seatsCount / rowLabels.length);
  for (let row = 1; row <= rows; row += 1) {
    for (const label of rowLabels) {
      if (seatMap.length >= seatsCount) {
        break;
      }
      seatMap.push({ seatNumber: `${row}${label}`, status: "available" });
    }
  }
  return seatMap;
}

for (const flight of flights.values()) {
  seatMaps.set(flight.id, createSeatMap(flight.totalSeats));
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export function getFlights(filters?: { from?: string; to?: string; date?: string }): Flight[] {
  return Array.from(flights.values()).filter((flight) => {
    if (filters?.from && flight.from !== filters.from.toUpperCase()) {
      return false;
    }
    if (filters?.to && flight.to !== filters.to.toUpperCase()) {
      return false;
    }
    if (filters?.date && flight.date !== filters.date) {
      return false;
    }
    return true;
  });
}

export function getFlightById(flightId: string): Flight | undefined {
  return flights.get(flightId);
}

export function getSeatsByFlightId(flightId: string): Seat[] | undefined {
  return seatMaps.get(flightId);
}

export function updateSeatStatus(
  flightId: string,
  seatNumber: string,
  status: SeatStatus
): Seat | undefined {
  const seats = seatMaps.get(flightId);
  if (!seats) {
    return undefined;
  }
  const seat = seats.find((item) => item.seatNumber === seatNumber);
  if (!seat) {
    return undefined;
  }
  seat.status = status;
  if (status !== "reserved") {
    seat.bookingId = undefined;
  }
  return seat;
}

export function createBooking(data: {
  flightId: string;
  seatNumber: string;
  passengerName: string;
  passengerEmail: string;
}): { booking?: Booking; message?: string } {
  const flight = flights.get(data.flightId);
  const seats = seatMaps.get(data.flightId);
  if (!flight || !seats) {
    return { message: "Flight not found." };
  }

  const seat = seats.find((item) => item.seatNumber === data.seatNumber);
  if (!seat) {
    return { message: "Seat not found." };
  }
  if (seat.status !== "available") {
    return { message: "Seat is not available." };
  }
  if (flight.availableSeats <= 0) {
    return { message: "No seats left on this flight." };
  }

  const booking: Booking = {
    id: randomId("BK"),
    flightId: data.flightId,
    passengerName: data.passengerName.trim(),
    passengerEmail: data.passengerEmail.trim().toLowerCase(),
    seatNumber: data.seatNumber,
    status: "confirmed",
    createdAt: new Date().toISOString(),
  };

  seat.status = "reserved";
  seat.bookingId = booking.id;
  flight.availableSeats -= 1;
  bookings.set(booking.id, booking);
  return { booking };
}

export function getBookingById(bookingId: string): Booking | undefined {
  return bookings.get(bookingId);
}

export function upsertFlight(data: Flight): Flight {
  flights.set(data.id, data);
  if (!seatMaps.has(data.id)) {
    seatMaps.set(data.id, createSeatMap(data.totalSeats));
  }
  return data;
}
