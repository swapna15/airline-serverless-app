import { auth } from "@/auth";
import { getBookingById, getFlightById, updateUserLoyaltyPoints, createLoyaltyTransaction } from "@/lib/db";
import { addAncillaryToBooking, AncillaryType } from "@/lib/ancillary";
import { createRequestLogger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const VALID_TYPES: AncillaryType[] = [
  "seat_upgrade",
  "baggage",
  "lounge",
  "hotel",
  "ground_transport",
];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> }
) {
  const session = await auth();
  const logger = createRequestLogger(
    request.headers.get("x-correlation-id") ?? undefined,
    session?.user?.id
  );

  if (!session?.user?.id) {
    logger.finish({ route: "/api/bookings/[bookingId]/ancillaries", method: "GET", status: 401 });
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const { bookingId } = await params;

  const booking = await getBookingById(bookingId);
  if (!booking) {
    logger.finish({ route: "/api/bookings/[bookingId]/ancillaries", method: "GET", status: 404 });
    return NextResponse.json({ message: "Booking not found." }, { status: 404 });
  }

  if (booking.userId !== session.user.id) {
    logger.finish({ route: "/api/bookings/[bookingId]/ancillaries", method: "GET", status: 403 });
    return NextResponse.json({ message: "Forbidden." }, { status: 403 });
  }

  logger.finish({ route: "/api/bookings/[bookingId]/ancillaries", method: "GET", status: 200 });
  return NextResponse.json(booking.ancillaries ?? []);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> }
) {
  const session = await auth();
  const logger = createRequestLogger(
    request.headers.get("x-correlation-id") ?? undefined,
    session?.user?.id
  );

  if (!session?.user?.id) {
    logger.finish({ route: "/api/bookings/[bookingId]/ancillaries", method: "POST", status: 401 });
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const { bookingId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logger.finish({ route: "/api/bookings/[bookingId]/ancillaries", method: "POST", status: 400 });
    return NextResponse.json({ message: "Invalid request body." }, { status: 400 });
  }

  const { type, name, price, provider } = body as Record<string, unknown>;

  if (!type || !VALID_TYPES.includes(type as AncillaryType)) {
    logger.finish({ route: "/api/bookings/[bookingId]/ancillaries", method: "POST", status: 400 });
    return NextResponse.json(
      { message: `type must be one of: ${VALID_TYPES.join(", ")}.` },
      { status: 400 }
    );
  }
  if (!name || typeof name !== "string" || name.trim() === "") {
    logger.finish({ route: "/api/bookings/[bookingId]/ancillaries", method: "POST", status: 400 });
    return NextResponse.json({ message: "name must be a non-empty string." }, { status: 400 });
  }
  if (typeof price !== "number" || price <= 0) {
    logger.finish({ route: "/api/bookings/[bookingId]/ancillaries", method: "POST", status: 400 });
    return NextResponse.json({ message: "price must be a positive number." }, { status: 400 });
  }
  if (!provider || typeof provider !== "string" || provider.trim() === "") {
    logger.finish({ route: "/api/bookings/[bookingId]/ancillaries", method: "POST", status: 400 });
    return NextResponse.json({ message: "provider must be a non-empty string." }, { status: 400 });
  }

  const booking = await getBookingById(bookingId);
  if (!booking) {
    logger.finish({ route: "/api/bookings/[bookingId]/ancillaries", method: "POST", status: 404 });
    return NextResponse.json({ message: "Booking not found." }, { status: 404 });
  }

  if (booking.userId !== session.user.id) {
    logger.finish({ route: "/api/bookings/[bookingId]/ancillaries", method: "POST", status: 403 });
    return NextResponse.json({ message: "Forbidden." }, { status: 403 });
  }

  const flight = await getFlightById(booking.flightId);
  if (!flight) {
    logger.finish({ route: "/api/bookings/[bookingId]/ancillaries", method: "POST", status: 404 });
    return NextResponse.json({ message: "Associated flight not found." }, { status: 404 });
  }

  const departureTime = new Date(`${flight.date}T${flight.departureTime}`);

  const item = {
    type: type as AncillaryType,
    name: (name as string).trim(),
    price: price as number,
    provider: (provider as string).trim(),
  };

  const result = await addAncillaryToBooking(bookingId, item, departureTime);
  if (result.error) {
    logger.finish({ route: "/api/bookings/[bookingId]/ancillaries", method: "POST", status: 400 });
    return NextResponse.json({ message: result.error }, { status: 400 });
  }

  const userId = session.user.id;
  const points = Math.floor((price as number) * 5);

  await updateUserLoyaltyPoints(userId, points);
  await createLoyaltyTransaction({
    userId,
    type: "ancillary",
    points,
    referenceId: bookingId,
  });

  logger.finish({ route: "/api/bookings/[bookingId]/ancillaries", method: "POST", status: 201 });
  return NextResponse.json(result.booking, { status: 201 });
}
