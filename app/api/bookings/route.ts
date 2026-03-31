import { auth } from "@/auth";
import { createBooking } from "@/lib/db";
import { isValidEmail, isValidName } from "@/lib/validation";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const body = await request.json();
  const { flightId, passengers } = body;

  if (!flightId) {
    return NextResponse.json({ message: "flightId is required." }, { status: 400 });
  }
  if (!Array.isArray(passengers) || passengers.length === 0) {
    return NextResponse.json({ message: "passengers must be a non-empty array." }, { status: 400 });
  }

  for (const [i, p] of passengers.entries()) {
    if (!p.seatNumber) {
      return NextResponse.json({ message: `Passenger ${i + 1}: seatNumber is required.` }, { status: 400 });
    }
    if (!isValidName(p.passengerName)) {
      return NextResponse.json({ message: `Passenger ${i + 1}: invalid passengerName.` }, { status: 400 });
    }
    if (!isValidEmail(p.passengerEmail)) {
      return NextResponse.json({ message: `Passenger ${i + 1}: invalid passengerEmail.` }, { status: 400 });
    }
  }

  const result = await createBooking({ flightId, userId: session.user.id, passengers });
  if (!result.booking) {
    return NextResponse.json({ message: result.message }, { status: 400 });
  }

  return NextResponse.json(result.booking, { status: 201 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }
  try {
    const { getBookingsByUserId } = await import("@/lib/db");
    const bookings = await getBookingsByUserId(session.user.id);
    console.log(`[bookings] GET userId=${session.user.id} found=${bookings.length}`);
    return NextResponse.json(bookings);
  } catch (err) {
    console.error("[bookings] GET error:", err);
    return NextResponse.json([], { status: 200 });
  }
}
