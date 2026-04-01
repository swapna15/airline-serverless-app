import { auth } from "@/auth";
import { getUserById, getLoyaltyTransactionsByUserId } from "@/lib/db";
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
    logger.finish({ route: "/api/user/loyalty", method: "GET", status: 401 });
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const [user, transactions] = await Promise.all([
    getUserById(session.user.id),
    getLoyaltyTransactionsByUserId(session.user.id),
  ]);

  logger.finish({ route: "/api/user/loyalty", method: "GET", status: 200 });
  return NextResponse.json({
    balance: user?.loyaltyPoints ?? 0,
    transactions,
  });
}
