import { auth } from "@/auth";
import { getFlights } from "@/lib/db";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const region = process.env.AWS_REGION || "us-east-2";
const bedrockRegion = process.env.BEDROCK_REGION || "us-east-1";
const modelId = "amazon.titan-text-express-v1";

async function getBedrockClient() {
  // Try Secrets Manager first for production; fall back to env vars
  try {
    const secretName = process.env.BEDROCK_SECRET_NAME;
    if (secretName) {
      const { SecretsManagerClient, GetSecretValueCommand } = await import(
        "@aws-sdk/client-secrets-manager"
      );
      const sm = new SecretsManagerClient({ region });
      const secret = await sm.send(new GetSecretValueCommand({ SecretId: secretName }));
      const creds = JSON.parse(secret.SecretString ?? "{}");
      return new BedrockRuntimeClient({
        region: creds.region ?? region,
        credentials: {
          accessKeyId: creds.accessKeyId,
          secretAccessKey: creds.secretAccessKey,
        },
      });
    }
  } catch {
    // Fall through to default credentials
  }
  return new BedrockRuntimeClient({ region: bedrockRegion });
}

export async function POST(request: NextRequest) {
  const session = await auth().catch(() => null);

  const body = await request.json();
  const { message } = body;

  if (!message || typeof message !== "string") {
    return NextResponse.json({ message: "message is required." }, { status: 400 });
  }

  // Fetch current flights to give the AI context
  let flightContext = "";
  try {
    const flights = await getFlights();
    flightContext = flights
      .slice(0, 10)
      .map(
        (f) =>
          `${f.id}: ${f.from}→${f.to} on ${f.date} dep ${f.departureTime} arr ${f.arrivalTime} $${f.price} (${f.availableSeats} seats left, status: ${f.status ?? "active"})`
      )
      .join("\n");
  } catch {
    flightContext = "Flight data temporarily unavailable.";
  }

  const systemPrompt = `You are AirApp's friendly flight assistant. Help passengers find flights, understand booking, and answer travel questions.

Current available flights:
${flightContext}

Keep responses concise and helpful. If asked about a specific route or date, refer to the flight data above.${session?.user ? ` The passenger's name is ${session.user.name}.` : ""}`;

  try {
    const client = await getBedrockClient();

    const payload = {
      inputText: `${systemPrompt}\n\nUser: ${message}\n\nAssistant:`,
      textGenerationConfig: {
        maxTokenCount: 512,
        temperature: 0.7,
        topP: 0.9,
      },
    };

    const command = new InvokeModelCommand({
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(payload),
    });

    const response = await client.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));
    const reply = result.results?.[0]?.outputText?.trim() ?? "Sorry, I couldn't generate a response.";

    return NextResponse.json({ reply });
  } catch (err: unknown) {
    console.error("[chat] Bedrock error:", err);
    const msg = (err as { message?: string })?.message ?? "AI assistant unavailable.";
    return NextResponse.json({ reply: `Sorry, I'm having trouble right now. ${msg}` }, { status: 200 });
  }
}
