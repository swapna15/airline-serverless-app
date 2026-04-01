import { auth } from "@/auth";
import { deletePriceAlert, updatePriceAlert } from "@/lib/db";
import { createRequestLogger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ alertId: string }> }
) {
  const session = await auth();
  const logger = createRequestLogger(
    request.headers.get("x-correlation-id") ?? undefined,
    session?.user?.id
  );

  if (!session?.user?.id) {
    logger.finish({ route: "/api/price-alerts/[alertId]", method: "PUT", status: 401 });
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const { alertId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logger.finish({ route: "/api/price-alerts/[alertId]", method: "PUT", status: 400 });
    return NextResponse.json({ message: "Invalid JSON body." }, { status: 400 });
  }

  const updates = body as Record<string, unknown>;

  // Validate threshold if provided
  if (updates.threshold !== undefined) {
    if (typeof updates.threshold !== "number" || updates.threshold <= 0) {
      logger.finish({ route: "/api/price-alerts/[alertId]", method: "PUT", status: 400 });
      return NextResponse.json(
        { message: "threshold must be a positive number." },
        { status: 400 }
      );
    }
  }

  // Validate departureDate if provided
  if (updates.departureDate !== undefined) {
    if (
      typeof updates.departureDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(updates.departureDate)
    ) {
      logger.finish({ route: "/api/price-alerts/[alertId]", method: "PUT", status: 400 });
      return NextResponse.json(
        { message: "departureDate must be in YYYY-MM-DD format." },
        { status: 400 }
      );
    }
  }

  const updated = await updatePriceAlert(session.user.id, alertId, updates);
  if (!updated) {
    logger.finish({ route: "/api/price-alerts/[alertId]", method: "PUT", status: 404 });
    return NextResponse.json({ message: "Price alert not found." }, { status: 404 });
  }

  logger.finish({ route: "/api/price-alerts/[alertId]", method: "PUT", status: 200 });
  return NextResponse.json(updated);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ alertId: string }> }
) {
  const session = await auth();
  const logger = createRequestLogger(
    request.headers.get("x-correlation-id") ?? undefined,
    session?.user?.id
  );

  if (!session?.user?.id) {
    logger.finish({ route: "/api/price-alerts/[alertId]", method: "DELETE", status: 401 });
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const { alertId } = await params;

  await deletePriceAlert(session.user.id, alertId);

  logger.finish({ route: "/api/price-alerts/[alertId]", method: "DELETE", status: 204 });
  return new NextResponse(null, { status: 204 });
}
