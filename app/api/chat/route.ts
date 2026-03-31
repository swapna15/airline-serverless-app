import { auth } from "@/auth";
import { AGENT_TOOLS, executeTool } from "@/lib/agent-tools";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  Tool,
} from "@aws-sdk/client-bedrock-runtime";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const bedrockRegion = process.env.BEDROCK_REGION || "us-east-1";
const modelId = "us.anthropic.claude-sonnet-4-5-20251001-v1:0";
const MAX_ITERATIONS = 10;

async function getBedrockClient() {
  try {
    const secretName = process.env.BEDROCK_SECRET_NAME;
    if (secretName) {
      const { SecretsManagerClient, GetSecretValueCommand } = await import(
        "@aws-sdk/client-secrets-manager"
      );
      const sm = new SecretsManagerClient({ region: process.env.AWS_REGION || "us-east-2" });
      const secret = await sm.send(new GetSecretValueCommand({ SecretId: secretName }));
      const creds = JSON.parse(secret.SecretString ?? "{}");
      return new BedrockRuntimeClient({
        region: creds.region ?? bedrockRegion,
        credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
      });
    }
  } catch { /* fall through */ }
  return new BedrockRuntimeClient({ region: bedrockRegion });
}

// Build Bedrock toolConfig from AGENT_TOOLS
const toolConfig = {
  tools: AGENT_TOOLS.map((t) => ({
    toolSpec: {
      name: t.name,
      description: t.description,
      inputSchema: { json: t.inputSchema },
    },
  })) as Tool[],
};

export async function POST(request: NextRequest) {
  const session = await auth().catch(() => null);
  const userId = session?.user?.id;

  const body = await request.json();
  const { message, history } = body;

  if (!message || typeof message !== "string") {
    return NextResponse.json({ message: "message is required." }, { status: 400 });
  }
  if (history !== undefined && !Array.isArray(history)) {
    return NextResponse.json({ message: "history must be an array." }, { status: 400 });
  }

  const systemPrompt = `You are AirApp's flight booking assistant. Use tools to get real data.
Rules: confirm booking details before calling create_booking. If user wants to book but isn't signed in, tell them to sign in at /login.${userId && session?.user?.name ? ` User: ${session.user.name}.` : ""}`;

  // Build initial messages from history + new user message
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    ...(history ?? []).map((h: { role: string; content: string }) => ({
      role: h.role,
      content: [{ text: h.content }],
    })),
    { role: "user", content: [{ text: message }] },
  ];

  try {
    const client = await getBedrockClient();
    let iterations = 0;
    let finalReply = "Sorry, I couldn't generate a response.";

    // Agentic loop
    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const command = new ConverseCommand({
        modelId,
        system: [{ text: systemPrompt }],
        messages,
        toolConfig,
        inferenceConfig: { maxTokens: 512, temperature: 0.7 },
      });

      const response = await client.send(command);
      const assistantMessage = response.output?.message;
      if (assistantMessage) messages.push(assistantMessage);

      if (response.stopReason === "end_turn") {
        // Extract text from the final response
        const textBlock = assistantMessage?.content?.find((b: { text?: string }) => b.text);
        finalReply = textBlock?.text?.trim() ?? finalReply;
        break;
      }

      if (response.stopReason === "tool_use") {
        // Execute all tool calls and collect results
        const toolResultContents: unknown[] = [];

        for (const block of assistantMessage?.content ?? []) {
          const toolUse = (block as { toolUse?: { toolUseId: string; name: string; input: Record<string, unknown> } }).toolUse;
          if (!toolUse) continue;

          const result = await executeTool(toolUse.name, toolUse.input ?? {}, { userId });
          const hasError = typeof result === "object" && result !== null && "error" in result;

          toolResultContents.push({
            toolResult: {
              toolUseId: toolUse.toolUseId,
              content: [{ text: JSON.stringify(result) }],
              status: hasError ? "error" : "success",
            },
          });
        }

        // Append tool results as a user message and loop
        messages.push({ role: "user", content: toolResultContents });
        continue;
      }

      // Any other stop reason — extract whatever text we have
      const textBlock = assistantMessage?.content?.find((b: { text?: string }) => b.text);
      if (textBlock?.text) finalReply = textBlock.text.trim();
      break;
    }

    return NextResponse.json({ reply: finalReply });
  } catch (err: unknown) {
    console.error("[chat] Bedrock error:", err);
    const msg = (err as { message?: string })?.message ?? "AI assistant unavailable.";
    return NextResponse.json({ reply: `Sorry, I'm having trouble right now. ${msg}` }, { status: 200 });
  }
}
