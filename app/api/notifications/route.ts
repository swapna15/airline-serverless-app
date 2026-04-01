import { auth } from "@/auth";
import { getUnreadNotificationsByUserId } from "@/lib/db";
import { createRequestLogger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await auth();
  const logger = createRequestLogger(
    request.headers.get("x-correlation-id") ?? undefined,
    session?.user?.id
  );

  if (!session?.user?.id) {
    logger.finish({ route: "/api/notifications", method: "GET", status: 401 });
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const notifications = await getUnreadNotificationsByUserId(session.user.id);
  logger.finish({ route: "/api/notifications", method: "GET", status: 200 });
  return NextResponse.json(notifications);
}
