import { auth } from "@/auth";
import { getBookingById } from "@/lib/db";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createRequestLogger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-2" });
const docClient = DynamoDBDocumentClient.from(client);
const bookingsTable = process.env.DDB_BOOKINGS_TABLE || "airline-bookings";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> }
) {
  const session = await auth();
  const logger = createRequestLogger(
    request.headers.get("x-correlation-id") ?? undefined,
    session?.user?.id
  );

  if (!session?.user?.id) {
    logger.finish({ route: "/api/bookings/[bookingId]/auto-rebook", method: "PATCH", status: 401 });
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const { bookingId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logger.finish({ route: "/api/bookings/[bookingId]/auto-rebook", method: "PATCH", status: 400 });
    return NextResponse.json({ message: "Invalid request body." }, { status: 400 });
  }

  const { autoRebook } = body as Record<string, unknown>;
  if (typeof autoRebook !== "boolean") {
    logger.finish({ route: "/api/bookings/[bookingId]/auto-rebook", method: "PATCH", status: 400 });
    return NextResponse.json({ message: "autoRebook (boolean) is required." }, { status: 400 });
  }

  const booking = await getBookingById(bookingId);
  if (!booking) {
    logger.finish({ route: "/api/bookings/[bookingId]/auto-rebook", method: "PATCH", status: 404 });
    return NextResponse.json({ message: "Booking not found." }, { status: 404 });
  }

  if (booking.userId !== session.user.id) {
    logger.finish({ route: "/api/bookings/[bookingId]/auto-rebook", method: "PATCH", status: 403 });
    return NextResponse.json({ message: "Forbidden." }, { status: 403 });
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: bookingsTable,
      Key: { id: bookingId },
      UpdateExpression: "SET autoRebook = :autoRebook",
      ExpressionAttributeValues: { ":autoRebook": autoRebook },
      ReturnValues: "ALL_NEW",
    })
  );

  logger.finish({ route: "/api/bookings/[bookingId]/auto-rebook", method: "PATCH", status: 200 });
  return NextResponse.json(result.Attributes);
}
