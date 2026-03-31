import axios from "axios";
import { Booking, Flight, Seat, SeatStatus } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const BASE_URL = API_URL || "";

export const searchFlights = async (params: {
  from?: string;
  to?: string;
  date?: string;
}): Promise<Flight[]> => {
  const res = await axios.get(`${BASE_URL}/api/flights`, { params });
  return res.data as Flight[];
};

export const getFlightSeats = async (
  flightId: string
): Promise<{ flight: Flight; seats: Seat[] }> => {
  const res = await axios.get(`${BASE_URL}/api/flights/${flightId}/seats`);
  return res.data as { flight: Flight; seats: Seat[] };
};

// Auth-protected — always use local Next.js API (session not available in Lambda/API Gateway)
export const createBooking = async (data: {
  flightId: string;
  passengers: { seatNumber: string; passengerName: string; passengerEmail: string }[];
}): Promise<Booking> => {
  const res = await axios.post(`/api/bookings`, data);
  return res.data as Booking;
};

// Auth-protected — always use local Next.js API
export const getMyBookings = async (): Promise<Booking[]> => {
  const res = await axios.get(`/api/bookings`);
  return res.data as Booking[];
};

export const getBooking = async (bookingId: string): Promise<Booking> => {
  const res = await axios.get(`${BASE_URL}/api/bookings/${bookingId}`);
  return res.data as Booking;
};

export const updateSeat = async (
  flightId: string,
  seatNumber: string,
  status: SeatStatus
): Promise<Seat> => {
  const res = await axios.patch(`${BASE_URL}/api/flights/${flightId}/seats`, {
    seatNumber,
    status,
  });
  return res.data as Seat;
};

export const rescheduleFlight = async (
  flightId: string,
  data: { date: string; departureTime: string; arrivalTime: string }
): Promise<Flight> => {
  const res = await axios.patch(`${BASE_URL}/api/flights/${flightId}`, data);
  return res.data as Flight;
};

export const cancelFlight = async (flightId: string): Promise<Flight> => {
  const res = await axios.delete(`${BASE_URL}/api/flights/${flightId}`);
  return res.data as Flight;
};
