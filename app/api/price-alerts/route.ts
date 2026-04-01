import { auth } from "@/auth";
import { createPriceAlert, getPriceAlertsByUserId } from "@/lib/db";
import { createRequestLogger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Validates "XXX#XXX" format (two 3-letter IATA codes separated by #)
function isValidRouteKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}#[A-Z]{3}$/.test(value);
}

function isValidDepartureDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request: NextRequest) {
  const session = await auth();
  const logger = createRequestLogger(
    request.headers.get("x-correlation-id") ?? undefined,
    session?.user?.id
  );

  if (!session?.user?.id) {
    logger.finish({ route: "/api/price-alerts", method: "GET", status: 401 });
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const alerts = await getPriceAlertsByUserId(session.user.id);
  logger.finish({ route: "/api/price-alerts", method: "GET", status: 200 });
  return NextResponse.json(alerts);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  const logger = createRequestLogger(
    request.headers.get("x-correlation-id") ?? undefined,
    session?.user?.id
  );

  if (!session?.user?.id) {
    logger.finish({ route: "/api/price-alerts", method: "POST", status: 401 });
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logger.finish({ route: "/api/price-alerts", method: "POST", status: 400 });
    return NextResponse.json({ message: "Invalid JSON body." }, { status: 400 });
  }

  const { routeKey, threshold, departureDate } = body as Record<string, unknown>;

  if (!isValidRouteKey(routeKey)) {
    logger.finish({ route: "/api/price-alerts", method: "POST", status: 400 });
    return NextResponse.json(
      { message: "routeKey is required and must be in format 'XXX#XXX' (e.g. 'ORD#JFK')." },
      { status: 400 }
    );
  }

  if (typeof threshold !== "number" || threshold <= 0) {
    logger.finish({ route: "/api/price-alerts", method: "POST", status: 400 });
    return NextResponse.json(
      { message: "threshold is required and must be a positive number." },
      { status: 400 }
    );
  }

  if (departureDate !== undefined && !isValidDepartureDate(departureDate)) {
    logger.finish({ route: "/api/price-alerts", method: "POST", status: 400 });
    return NextResponse.json(
      { message: "departureDate must be in YYYY-MM-DD format." },
      { status: 400 }
    );
  }

  const alert = await createPriceAlert({
    userId: session.user.id,
    routeKey,
    threshold,
    departureDate: departureDate as string | undefined,
    status: "active",
  });

  logger.finish({ route: "/api/price-alerts", method: "POST", status: 201 });
  return NextResponse.json(alert, { status: 201 });
}
