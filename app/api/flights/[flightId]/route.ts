import { cancelFlight, updateFlightSchedule } from "@/lib/db";
import { isValidDate, isValidTime } from "@/lib/validation";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ flightId: string }> }
) {
  const { flightId } = await params;
  const body = await request.json();
  const { date, departureTime, arrivalTime } = body;

  if (!date || !departureTime || !arrivalTime) {
    return NextResponse.json(
      { message: "date, departureTime, and arrivalTime are required." },
      { status: 400 }
    );
  }
  if (!isValidDate(date)) {
    return NextResponse.json({ message: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
  }
  if (!isValidTime(departureTime)) {
    return NextResponse.json({ message: "Invalid departureTime format. Use HH:MM." }, { status: 400 });
  }
  if (!isValidTime(arrivalTime)) {
    return NextResponse.json({ message: "Invalid arrivalTime format. Use HH:MM." }, { status: 400 });
  }

  const flight = await updateFlightSchedule(flightId, { date, departureTime, arrivalTime });
  if (!flight) {
    return NextResponse.json({ message: "Flight not found." }, { status: 404 });
  }

  return NextResponse.json(flight);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ flightId: string }> }
) {
  const { flightId } = await params;
  const result = await cancelFlight(flightId);

  if (!result.flight) {
    const status = result.message?.includes("already cancelled") ? 400 : 404;
    return NextResponse.json({ message: result.message }, { status });
  }

  return NextResponse.json(result.flight);
}
