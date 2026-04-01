import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { randomUUID } from "crypto";

// ─── Environment ─────────────────────────────────────────────────────────────

const region = process.env.AWS_REGION || "us-east-2";
const sabreBaseUrl = process.env.SABRE_BASE_URL || "https://api.cert.platform.sabre.com";
const sabreUsername = process.env.SABRE_USERNAME;
const sabrePassword = process.env.SABRE_PASSWORD;
const bookingsTable = process.env.DDB_BOOKINGS_TABLE || "airline-bookings";
const flightsTable = process.env.DDB_FLIGHTS_TABLE || "airline-flights";
const notificationLogTable = process.env.DDB_NOTIFICATION_LOG_TABLE || "airline-notification-log";
const notificationWorkerFn = process.env.NOTIFICATION_WORKER_FUNCTION_NAME || "notification-worker";

// ─── AWS Clients ──────────────────────────────────────────────────────────────

const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);
const cwClient = new CloudWatchClient({ region });
const lambdaClient = new LambdaClient({ region });

// ─── Sabre token cache ────────────────────────────────────────────────────────

let cachedToken = null;
let tokenExpiresAt = 0;

async function getSabreToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt - now > 60_000) {
    return cachedToken;
  }

  const pcc = process.env.SABRE_PCC || "TEST";
  const rawUserId = sabreUsername.startsWith("V1:")
    ? sabreUsername
    : `V1:${sabreUsername}:${pcc}:AA`;

  const encodedClientId = Buffer.from(rawUserId).toString("base64");
  const encodedPassword = Buffer.from(sabrePassword).toString("base64");
  const combined = Buffer.from(`${encodedClientId}:${encodedPassword}`).toString("base64");

  const body = new URLSearchParams({ grant_type: "client_credentials" });

  const response = await fetch(`${sabreBaseUrl}/v2/auth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${combined}`,
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Sabre token fetch failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 1800) * 1000;
  return cachedToken;
}

// ─── Sabre Flight Status API ──────────────────────────────────────────────────

/**
 * Parse carrier code and flight number from a flight ID.
 * Real IATA format: "AA123" → { carrierCode: "AA", flightNumber: "123" }
 * Test format: "FL-1001" → returns null (not a real IATA flight)
 */
function parseFlightId(flightId) {
  if (!flightId) return null;
  if (/^FL-\d+$/i.test(flightId)) return null;
  const match = flightId.match(/^([A-Z]{2})(\d{1,4})$/i);
  if (!match) return null;
  return { carrierCode: match[1].toUpperCase(), flightNumber: match[2] };
}

/**
 * Call Sabre Flight Status API.
 * GET /v1/historical/flights/{carrierCode}{flightNumber}/status
 * Returns null if the flight ID is not a real IATA flight or the API call fails.
 */
async function getFlightStatus(flightId, scheduledDepartureDate, correlationId) {
  const parsed = parseFlightId(flightId);
  if (!parsed) {
    console.warn(
      JSON.stringify({
        correlationId,
        detail: "Skipping Sabre status check — flight ID is not a real IATA flight number",
        flightId,
      })
    );
    return null;
  }

  try {
    const token = await getSabreToken();
    const params = new URLSearchParams({ departureDate: scheduledDepartureDate });

    const response = await fetch(
      `${sabreBaseUrl}/v1/historical/flights/${parsed.carrierCode}${parsed.flightNumber}/status?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      console.warn(
        JSON.stringify({
          correlationId,
          detail: "Sabre flight status API returned non-OK response — skipping flight",
          flightId,
          status: response.status,
        })
      );
      return null;
    }

    const data = await response.json();
    const statuses = data?.flightStatusResponse?.flightStatuses ?? [];
    return statuses.length > 0 ? statuses[0] : null;
  } catch (err) {
    console.warn(
      JSON.stringify({
        correlationId,
        detail: "Sabre flight status API call failed — skipping flight",
        flightId,
        error: err.message,
      })
    );
    return null;
  }
}

// ─── Disruption detection ─────────────────────────────────────────────────────

/**
 * Analyse a Sabre flight status response and determine if a disruption exists.
 * Returns { disrupted: true, disruptionType } or { disrupted: false }.
 */
function detectDisruption(flightStatus) {
  if (!flightStatus) return { disrupted: false };

  // Sabre flight status: check top-level flightStatus field
  const status = (flightStatus.flightStatus || "").toUpperCase();
  if (status === "CANCELLED" || status === "CANCELED") {
    return { disrupted: true, disruptionType: "CANCELLED" };
  }

  // Check delay minutes from Sabre delays object
  const delayMin = flightStatus.delays?.departureDelayMinutes
    || flightStatus.delays?.arrivalDelayMinutes
    || 0;
  if (delayMin >= 60) {
    return { disrupted: true, disruptionType: "DELAY", delayMinutes: delayMin };
  }

  // Check legs for weather advisory or delay
  const legs = flightStatus.legs || [];
  for (const leg of legs) {
    const remarks = leg.remarks || "";
    if (typeof remarks === "string" && /weather/i.test(remarks)) {
      return { disrupted: true, disruptionType: "WEATHER_ADVISORY" };
    }
    const legDelay = leg.departureDelayMinutes || leg.arrivalDelayMinutes || 0;
    if (legDelay >= 60) {
      return { disrupted: true, disruptionType: "DELAY", delayMinutes: legDelay };
    }
  }

  return { disrupted: false };
}

// ─── DynamoDB helpers ─────────────────────────────────────────────────────────

/** Scan all confirmed bookings (no filter on departure — we'll filter in memory). */
async function scanConfirmedBookings() {
  const items = [];
  let lastKey;
  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: bookingsTable,
        FilterExpression: "#s = :confirmed",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":confirmed": "confirmed" },
        ExclusiveStartKey: lastKey,
      })
    );
    items.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function getFlight(flightId) {
  try {
    const result = await docClient.send(
      new GetCommand({ TableName: flightsTable, Key: { id: flightId } })
    );
    return result.Item || null;
  } catch {
    return null;
  }
}

/**
 * Find all confirmed bookings for a given flightId.
 * We re-use the already-scanned bookings list to avoid extra DDB calls.
 */
function getBookingsForFlight(allBookings, flightId) {
  return allBookings.filter((b) => b.flightId === flightId && b.status === "confirmed");
}

/**
 * Search for alternative flights on the same route departing within 6 hours of
 * the original departure. Returns up to 3 results from the airline-flights table.
 */
async function findAlternativeFlights(flight, originalDepartureMs, correlationId) {
  const origin = flight.from;
  const destination = flight.to;
  if (!origin || !destination) return [];

  const windowStart = new Date(originalDepartureMs - 6 * 60 * 60 * 1000);
  const windowEnd = new Date(originalDepartureMs + 6 * 60 * 60 * 1000);

  // Scan flights table for same route, different flight, within window
  // In production this would use a GSI; for now we scan with a filter
  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: flightsTable,
        FilterExpression:
          "#from = :origin AND #to = :dest AND #id <> :flightId AND #status <> :cancelled",
        ExpressionAttributeNames: {
          "#from": "from",
          "#to": "to",
          "#id": "id",
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":origin": origin,
          ":dest": destination,
          ":flightId": flight.id,
          ":cancelled": "cancelled",
        },
      })
    );

    const candidates = (result.Items || []).filter((f) => {
      if (!f.date || !f.departureTime) return false;
      const depMs = new Date(`${f.date}T${f.departureTime}`).getTime();
      return depMs >= windowStart.getTime() && depMs <= windowEnd.getTime();
    });

    // Sort by departure time and return up to 3
    candidates.sort((a, b) => {
      const aMs = new Date(`${a.date}T${a.departureTime}`).getTime();
      const bMs = new Date(`${b.date}T${b.departureTime}`).getTime();
      return aMs - bMs;
    });

    return candidates.slice(0, 3);
  } catch (err) {
    console.warn(
      JSON.stringify({
        correlationId,
        detail: "Failed to search alternative flights",
        error: err.message,
      })
    );
    return [];
  }
}

// ─── Lambda invocation ────────────────────────────────────────────────────────

async function invokeNotificationWorker(payload, correlationId) {
  try {
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: notificationWorkerFn,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify({ ...payload, correlationId })),
      })
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        correlationId,
        detail: "notification-worker invoke failed",
        error: err.message,
      })
    );
  }
}

// ─── CloudWatch metrics ───────────────────────────────────────────────────────

async function publishMetrics(metrics) {
  try {
    const metricData = metrics.map(({ name, value }) => ({
      MetricName: name,
      Value: value,
      Unit: "Count",
      Timestamp: new Date(),
    }));
    await cwClient.send(
      new PutMetricDataCommand({
        Namespace: "DisruptionDetector",
        MetricData: metricData,
      })
    );
  } catch (err) {
    console.error(
      JSON.stringify({ detail: "CloudWatch metrics publish failed", error: err.message })
    );
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export const handler = async (event) => {
  const correlationId = event?.correlationId || randomUUID();
  const startTime = Date.now();
  let flightsChecked = 0;
  let disruptionsDetected = 0;
  let pollSuccess = false;

  try {
    // ── Sub-task 14.1: Core disruption detection ──────────────────────────────

    // 1. Scan all confirmed bookings
    const allBookings = await scanConfirmedBookings();

    // 2. Collect unique flightIds and filter to those departing within 24h
    const now = Date.now();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;

    const uniqueFlightIds = [...new Set(allBookings.map((b) => b.flightId).filter(Boolean))];

    // For each unique flightId, load the flight and check departure window
    const flightsWithin24h = [];
    for (const flightId of uniqueFlightIds) {
      const flight = await getFlight(flightId);
      if (!flight) continue;

      if (!flight.date || !flight.departureTime) continue;

      const depMs = new Date(`${flight.date}T${flight.departureTime}`).getTime();
      const msUntilDep = depMs - now;

      if (msUntilDep > 0 && msUntilDep <= twentyFourHoursMs) {
        flightsWithin24h.push({ flight, depMs });
      }
    }

    // 3. For each unique flight departing within 24h, check Sabre status
    for (const { flight, depMs } of flightsWithin24h) {
      flightsChecked++;
      const scheduledDepartureDate = flight.date;

      const flightStatus = await getFlightStatus(flight.id, scheduledDepartureDate, correlationId);

      // If Sabre returned no data (test flight IDs, API failure, etc.) — skip
      if (!flightStatus) continue;

      const { disrupted, disruptionType, delayMinutes } = detectDisruption(flightStatus);
      if (!disrupted) continue;

      disruptionsDetected++;

      // ── Sub-task 14.2: Disruption response ───────────────────────────────────

      // 4a. Find all confirmed bookings for this flight
      const affectedBookings = getBookingsForFlight(allBookings, flight.id);
      if (affectedBookings.length === 0) continue;

      const bookingIds = affectedBookings.map((b) => b.id);

      // 4b. Search for up to 3 alternative flights within 6h window
      const alternatives = await findAlternativeFlights(flight, depMs, correlationId);
      const noAlternatives = alternatives.length === 0;

      // 4c. Invoke notification-worker for each affected booking
      for (const booking of affectedBookings) {
        const disruptionMessage = noAlternatives
          ? `Your flight ${flight.id} has been disrupted (${disruptionType}${delayMinutes ? ` — ${delayMinutes} min delay` : ""}). No alternative flights are available within 6 hours. You may rebook on the next available flight or request a full refund.`
          : `Your flight ${flight.id} has been disrupted (${disruptionType}${delayMinutes ? ` — ${delayMinutes} min delay` : ""}). We have found ${alternatives.length} alternative flight(s) for you.`;

        await invokeNotificationWorker(
          {
            userId: booking.userId,
            type: "disruption",
            message: disruptionMessage,
            metadata: {
              bookingId: booking.id,
              flightId: flight.id,
              disruptionType,
              delayMinutes: delayMinutes || null,
              alternatives: alternatives.map((a) => ({
                flightId: a.id,
                from: a.from,
                to: a.to,
                date: a.date,
                departureTime: a.departureTime,
                price: a.price,
              })),
              noAlternatives,
            },
          },
          correlationId
        );
      }

      // 4d. Write DisruptionEvent record to airline-notification-log
      await docClient.send(
        new PutCommand({
          TableName: notificationLogTable,
          Item: {
            userId: "system",
            notificationId: randomUUID(),
            channel: "inApp",
            message: `Disruption detected on flight ${flight.id}: ${disruptionType}`,
            sentAt: new Date().toISOString(),
            status: "sent",
            metadata: {
              flightId: flight.id,
              disruptionType,
              affectedBookings: bookingIds,
            },
          },
        })
      );

      console.log(
        JSON.stringify({
          correlationId,
          detail: "Disruption event processed",
          flightId: flight.id,
          disruptionType,
          affectedBookings: bookingIds.length,
          alternatives: alternatives.length,
          noAlternatives,
        })
      );
    }

    pollSuccess = true;

    // ── Sub-task 14.3: CloudWatch metrics and logging ─────────────────────────

    await publishMetrics([
      { name: "PollSuccess", value: 1 },
      { name: "FlightsChecked", value: flightsChecked },
      { name: "DisruptionsDetected", value: disruptionsDetected },
    ]);
  } catch (err) {
    console.error(
      JSON.stringify({
        correlationId,
        detail: "disruption-detector handler error",
        error: err.message,
        stack: err.stack,
      })
    );

    await publishMetrics([{ name: "PollFailure", value: 1 }]);

    throw err;
  } finally {
    const duration = Date.now() - startTime;
    // 7. Emit structured JSON log
    console.log(
      JSON.stringify({
        correlationId,
        duration,
        flightsChecked,
        disruptionsDetected,
        status: pollSuccess ? "success" : "error",
      })
    );
  }
};
