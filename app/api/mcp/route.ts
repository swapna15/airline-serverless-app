import { AGENT_TOOLS, executeTool } from "@/lib/agent-tools";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
};

function rpcResult(id: string | number, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: string | number | null, code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } });
}

export async function POST(request: NextRequest) {
  let body: JsonRpcRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id, method, params } = body;

  // tools/list — return all available tools
  if (method === "tools/list") {
    return rpcResult(id, {
      tools: AGENT_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  }

  // tools/call — execute a tool
  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments ?? {};

    if (!toolName) {
      return rpcError(id, -32602, "params.name is required for tools/call");
    }

    const tool = AGENT_TOOLS.find((t) => t.name === toolName);
    if (!tool) {
      return rpcError(id, -32602, `Unknown tool: "${toolName}". Call tools/list to see available tools.`);
    }

    // Validate required params
    const required = tool.inputSchema.required ?? [];
    const missing = required.filter((k) => !(k in args));
    if (missing.length > 0) {
      return rpcError(id, -32602, `Missing required arguments for "${toolName}": ${missing.join(", ")}`);
    }

    try {
      // For auth-gated tools, userId must be supplied in arguments
      const userId = args.userId as string | undefined;
      const result = await executeTool(toolName, args, { userId });
      const hasError = typeof result === "object" && result !== null && "error" in result;

      return rpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: hasError,
      });
    } catch (err) {
      return rpcResult(id, {
        content: [{ type: "text", text: `Tool execution failed: ${(err as Error).message}` }],
        isError: true,
      });
    }
  }

  // Unknown method
  return rpcError(id, -32601, `Method not found: "${method}". Supported methods: tools/list, tools/call`);
}
