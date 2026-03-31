export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (req: NextRequest, ctx?: any) => Promise<Response>;

export const GET: AnyHandler = async (req) => {
  const { handlers } = await import("@/auth");
  return (handlers.GET as AnyHandler)(req);
};

export const POST: AnyHandler = async (req) => {
  const { handlers } = await import("@/auth");
  return (handlers.POST as AnyHandler)(req);
};
