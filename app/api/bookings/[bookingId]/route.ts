import { getBookingById } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> }
) {
  const { bookingId } = await params;
  const booking = await getBookingById(bookingId);
  if (!booking) {
    return NextResponse.json({ message: "Booking not found." }, { status: 404 });
  }
  return NextResponse.json(booking);
}
