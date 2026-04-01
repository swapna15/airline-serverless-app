import { getFlights } from "@/lib/db";
import { SabreClient, SabreMockClient } from "@/lib/sabre";
import { isValidDate, isValidIATA } from "@/lib/validation";
import { NextRequest, NextResponse } from "next/server";
import type { Flight } from "@/lib/types";

export const dynamic = 'force-dynamic';

// Create client fresh on each cold start, respecting SABRE_ENV
function getSabreClient() {
  if (process.env.SABRE_ENV === 'mock') {
    return new SabreMockClient();
  }
  return new SabreClient(
    process.env.SABRE_USERNAME ?? '',
    process.env.SABRE_PASSWORD ?? '',
    process.env.SABRE_ENV === 'production' ? 'production' : 'cert'
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from")?.toUpperCase() ?? undefined;
  const to = searchParams.get("to")?.toUpperCase() ?? undefined;
  const date = searchParams.get("date") ?? undefined;

  if (from && !isValidIATA(from)) {
    return NextResponse.json({ message: "Invalid 'from' airport code. Must be 3 uppercase letters." }, { status: 400 });
  }
  if (to && !isValidIATA(to)) {
    return NextResponse.json({ message: "Invalid 'to' airport code. Must be 3 uppercase letters." }, { status: 400 });
  }
  if (date && !isValidDate(date)) {
    return NextResponse.json({ message: "Invalid 'date' format. Use YYYY-MM-DD." }, { status: 400 });
  }

  // Try Sabre when both origin and destination are provided
  if (from && to) {
    const departureDate = date ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    try {
      const client = getSabreClient();
      const offers = await client.searchFlightOffers({
        originLocationCode: from,
        destinationLocationCode: to,
        departureDate,
        adults: 1,
        currencyCode: 'USD',
        max: 20,
      });

      if (offers.length > 0) {
        const sabreFlights: Flight[] = offers.map((offer, i) => {
          const journey = (offer.itineraries?.[0] as Record<string, unknown>) ?? {}
          const segments = (journey.segments as Record<string, unknown>[]) ?? []
          const segment = segments[0] ?? {}
          const dep = String(segment.departureDateTime ?? `${departureDate}T00:00:00`)
          const arr = String(segment.arrivalDateTime ?? `${departureDate}T02:00:00`)
          const depTime = dep.slice(11, 16) || '00:00'
          const arrTime = arr.slice(11, 16) || '02:00'
          const carrier = String(segment.carrierCode ?? 'XX')
          const flightNum = String(segment.flightNumber ?? i + 1)
          const price = parseFloat(offer.price.total) || 0

          return {
            id: offer.id || `SABRE-${i + 1}`,
            from,
            to,
            date: departureDate,
            departureTime: depTime,
            arrivalTime: arrTime,
            price,
            totalSeats: 9,
            availableSeats: 9,
            carrier: `${carrier}${flightNum}`,
          } as Flight & { carrier: string }
        })

        return NextResponse.json(sabreFlights)
      }
    } catch (err) {
      console.warn('[flights] Sabre search failed, falling back to DynamoDB:', (err as Error).message)
    }
  }

  // Fallback: DynamoDB flights
  const flights = await getFlights({ from, to, date });
  return NextResponse.json(flights);
}
