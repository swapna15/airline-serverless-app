export type SeatStatus = "available" | "reserved" | "blocked";

export type FlightStatus = "active" | "cancelled";

export type Flight = {
  id: string;
  from: string;
  to: string;
  date: string;
  departureTime: string;
  arrivalTime: string;
  price: number;
  totalSeats: number;
  availableSeats: number;
  status?: FlightStatus;
};

export type Seat = {
  seatNumber: string;
  status: SeatStatus;
  bookingId?: string;
};

export type BookingPassenger = {
  seatNumber: string;
  passengerName: string;
  passengerEmail: string;
};

export type Booking = {
  id: string;
  flightId: string;
  userId: string;
  passengers: BookingPassenger[];
  status: "confirmed" | "cancelled";
  createdAt: string;
  // legacy single-passenger fields (kept for backward compat)
  passengerName?: string;
  passengerEmail?: string;
  seatNumber?: string;
};

export type User = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
};
