const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");

const region = process.env.AWS_REGION || "us-east-2";
const flightsTable = process.env.FLIGHTS_TABLE || "airline-flights";
const modelId = "anthropic.claude-3-haiku-20240307-v1:0";

const bedrockClient = new BedrockRuntimeClient({ region });
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

function response(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { message } = body;
    if (!message) return response(400, { message: "message is required." });

    // Fetch flights for context
    let flightContext = "";
    try {
      const result = await ddbClient.send(new ScanCommand({ TableName: flightsTable, Limit: 10 }));
      flightContext = (result.Items || [])
        .map(f => `${f.id}: ${f.from}→${f.to} on ${f.date} dep ${f.departureTime} $${f.price} (${f.availableSeats} seats)`)
        .join("\n");
    } catch {
      flightContext = "Flight data unavailable.";
    }

    const payload = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 512,
      system: `You are AirApp's flight assistant. Current flights:\n${flightContext}`,
      messages: [{ role: "user", content: message }],
    };

    const cmd = new InvokeModelCommand({
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(payload),
    });

    const res = await bedrockClient.send(cmd);
    const result = JSON.parse(new TextDecoder().decode(res.body));
    const reply = result.content?.[0]?.text ?? "Sorry, I couldn't generate a response.";

    return response(200, { reply });
  } catch (err) {
    console.error("flightassistant error:", err);
    return response(500, { reply: "AI assistant temporarily unavailable." });
  }
};
