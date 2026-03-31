import { handlers } from "@/auth";

export const dynamic = "force-dynamic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const GET = handlers.GET as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const POST = handlers.POST as any;
