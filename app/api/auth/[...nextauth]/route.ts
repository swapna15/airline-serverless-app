export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const { handlers } = await import("@/auth");
  return handlers.GET(req);
}

export async function POST(req: NextRequest) {
  const { handlers } = await import("@/auth");
  return handlers.POST(req);
}
