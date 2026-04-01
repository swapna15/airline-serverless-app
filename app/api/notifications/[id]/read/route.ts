import { auth } from "@/auth";
import { markNotificationRead } from "@/lib/db";
import { createRequestLogger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const logger = createRequestLogger(
    request.headers.get("x-correlation-id") ?? undefined,
    session?.user?.id
  );

  if (!session?.user?.id) {
    logger.finish({ route: "/api/notifications/[id]/read", method: "PATCH", status: 401 });
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const { id } = await params;
  await markNotificationRead(session.user.id, id);
  logger.finish({ route: "/api/notifications/[id]/read", method: "PATCH", status: 200 });
  return NextResponse.json({ success: true });
}
