import { getFlightById, getSeatsByFlightId, updateSeatStatus } from "@/lib/db";
import { SeatStatus } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";

const VALID_STATUSES: SeatStatus[] = ["available", "reserved", "blocked"];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ flightId: string }> }
) {
  const { flightId } = await params;
  const flight = await getFlightById(flightId);
  if (!flight) {
    return NextResponse.json({ message: "Flight not found." }, { status: 404 });
  }
  const seats = await getSeatsByFlightId(flightId);
  return NextResponse.json({ flight, seats });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ flightId: string }> }
) {
  const { flightId } = await params;
  const { seatNumber, status } = await request.json();

  if (!seatNumber || !status) {
    return NextResponse.json(
      { message: "seatNumber and status are required." },
      { status: 400 }
    );
  }
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { message: `status must be one of: ${VALID_STATUSES.join(", ")}.` },
      { status: 400 }
    );
  }

  const flight = await getFlightById(flightId);
  if (!flight) {
    return NextResponse.json({ message: "Flight not found." }, { status: 404 });
  }

  const updatedSeat = await updateSeatStatus(flightId, seatNumber, status);
  if (!updatedSeat) {
    return NextResponse.json({ message: "Seat not found." }, { status: 404 });
  }

  return NextResponse.json(updatedSeat);
}
