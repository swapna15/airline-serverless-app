import { auth } from "@/auth";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { createRequestLogger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const lambda = new LambdaClient({ region: process.env.AWS_REGION || "us-east-2" });

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
    logger.finish({ route: "/api/bookings/[bookingId]/rebook", method: "POST", status: 401 });
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const { bookingId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logger.finish({ route: "/api/bookings/[bookingId]/rebook", method: "POST", status: 400 });
    return NextResponse.json({ message: "Invalid request body." }, { status: 400 });
  }

  const { replacementFlightId } = body as Record<string, unknown>;
  if (!replacementFlightId || typeof replacementFlightId !== "string") {
    logger.finish({ route: "/api/bookings/[bookingId]/rebook", method: "POST", status: 400 });
    return NextResponse.json({ message: "replacementFlightId is required." }, { status: 400 });
  }

  const payload = {
    bookingId,
    replacementFlightId,
    trigger: "manual",
    correlationId: logger.correlationId,
  };

  try {
    const command = new InvokeCommand({
      FunctionName: process.env.REBOOKING_ENGINE_FUNCTION_NAME || "rebooking-engine",
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify(payload)),
    });

    const response = await lambda.send(command);

    if (!response.Payload) {
      logger.finish({ route: "/api/bookings/[bookingId]/rebook", method: "POST", status: 500 });
      return NextResponse.json({ message: "No response from rebooking engine." }, { status: 500 });
    }

    const result = JSON.parse(Buffer.from(response.Payload).toString("utf-8"));
    logger.finish({ route: "/api/bookings/[bookingId]/rebook", method: "POST", status: 200 });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[rebook] Lambda invocation error:", err);
    logger.finish({ route: "/api/bookings/[bookingId]/rebook", method: "POST", status: 500 });
    return NextResponse.json({ message: "Rebooking engine invocation failed." }, { status: 500 });
  }
}
