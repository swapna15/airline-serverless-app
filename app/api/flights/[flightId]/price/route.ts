import { auth } from "@/auth";
import { getFlightById } from "@/lib/db";
import { sabreClient } from "@/lib/sabre";
import { createRequestLogger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ flightId: string }> }
) {
  // Auth is optional for price checks — allow unauthenticated
  const session = await auth();
  const logger = createRequestLogger(
    request.headers.get("x-correlation-id") ?? undefined,
    session?.user?.id
  );

  const { flightId } = await params;

  const flight = await getFlightById(flightId);
  if (!flight) {
    logger.finish({ route: "/api/flights/[flightId]/price", method: "GET", status: 404 });
    return NextResponse.json({ message: "Flight not found." }, { status: 404 });
  }

  // Build a minimal flight offer shape to pass to Sabre repricing
  const minimalOffer = {
    id: flight.id,
    source: "SABRE",
    itineraries: [],
    price: { total: String(flight.price), currency: "USD" },
    validatingCarrierCodes: [],
    pricingInformation: [],
  };

  try {
    const priced = await sabreClient.priceFlightOffer(minimalOffer);
    const confirmedPrice = parseFloat(priced.price.total);

    logger.finish({ route: "/api/flights/[flightId]/price", method: "GET", status: 200, stale: false });
    return NextResponse.json({
      price: confirmedPrice,
      confirmedAt: priced.confirmedAt,
      stale: false,
    });
  } catch {
    // Amadeus unavailable — fall back to cached DB price
    const cachedAt = (flight as { updatedAt?: string }).updatedAt ?? "unknown";
    let staleMinutes: number | undefined;

    if (cachedAt !== "unknown") {
      const ageMs = Date.now() - new Date(cachedAt).getTime();
      staleMinutes = Math.floor(ageMs / 60_000);
    }

    logger.finish({ route: "/api/flights/[flightId]/price", method: "GET", status: 200, stale: true });
    return NextResponse.json({
      price: flight.price,
      cachedAt,
      stale: true,
      ...(staleMinutes !== undefined ? { staleMinutes } : {}),
    });
  }
}
