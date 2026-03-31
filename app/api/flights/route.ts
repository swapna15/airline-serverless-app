import { getFlights } from "@/lib/db";
import { isValidDate, isValidIATA } from "@/lib/validation";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;
  const date = searchParams.get("date") ?? undefined;

  if (from && !isValidIATA(from.toUpperCase())) {
    return NextResponse.json({ message: "Invalid 'from' airport code. Must be 3 uppercase letters." }, { status: 400 });
  }
  if (to && !isValidIATA(to.toUpperCase())) {
    return NextResponse.json({ message: "Invalid 'to' airport code. Must be 3 uppercase letters." }, { status: 400 });
  }
  if (date && !isValidDate(date)) {
    return NextResponse.json({ message: "Invalid 'date' format. Use YYYY-MM-DD." }, { status: 400 });
  }

  const flights = await getFlights({ from, to, date });
  return NextResponse.json(flights);
}
