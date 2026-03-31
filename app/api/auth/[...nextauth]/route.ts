export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";

<<<<<<< HEAD
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
=======
export async function GET(req: NextRequest) {
  const { handlers } = await import("@/auth");
  return handlers.GET(req);
}

export async function POST(req: NextRequest) {
  const { handlers } = await import("@/auth");
  return handlers.POST(req);
}
>>>>>>> e5316498201f3d91bc80898efd75e3e4b0e2dabc
