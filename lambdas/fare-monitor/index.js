import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { randomUUID } from "crypto";

// ─── Environment ─────────────────────────────────────────────────────────────

const region = process.env.AWS_REGION || "us-east-2";
const sabreBaseUrl = process.env.SABRE_BASE_URL || "https://api.cert.platform.sabre.com";
const sabreUsername = process.env.SABRE_USERNAME;
const sabrePassword = process.env.SABRE_PASSWORD;
const sabrePcc = process.env.SABRE_PCC || "TEST";
const priceAlertsTable = process.env.DDB_PRICE_ALERTS_TABLE || "airline-price-alerts";
const bookingsTable = process.env.DDB_BOOKINGS_TABLE || "airline-bookings";
const flightsTable = process.env.DDB_FLIGHTS_TABLE || "airline-flights";
const notificationWorkerFn = process.env.NOTIFICATION_WORKER_FUNCTION_NAME || "notification-worker";
const rebookingEngineFn = process.env.REBOOKING_ENGINE_FUNCTION_NAME || "rebooking-engine";

// ─── AWS Clients ──────────────────────────────────────────────────────────────

const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);
const cwClient = new CloudWatchClient({ region });
const lambdaClient = new LambdaClient({ region });

// ─── Sabre token cache (module-level) ────────────────────────────────────────

let cachedToken = null;
let tokenExpiresAt = 0;

async function getSabreToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt - now > 60_000) {
    return cachedToken;
  }

  // Sabre triple base64 encoding:
  // 1. base64("V1:{username}:{PCC}:AA")
  // 2. base64(password)
  // 3. base64("{step1}:{step2}")
  const rawUserId = sabreUsername.startsWith("V1:")
    ? sabreUsername
    : `V1:${sabreUsername}:${sabrePcc}:AA`;

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

// ─── Sabre BargainFinderMax Flight Search ─────────────────────────────────────

// ─── Sabre Offers API Flight Search ──────────────────────────────────────────

async function searchFlightOffers(origin, destination, departureDate) {
  const token = await getSabreToken();

  const requestBody = {
    pointOfSale: {
      location: { countryCode: "US", cityCode: origin },
      agentDutyCode: "*",
    },
    journeys: [{
      departureLocation: { airportCode: origin },
      arrivalLocation: { airportCode: destination },
      departureDate,
    }],
    travelers: [{ id: "1", passengerTypeCode: "ADT" }],
    cabin: "ECONOMY",
    currency: "USD",
  };

  const response = await fetch(`${sabreBaseUrl}/v1/offers/flightShop/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(`Sabre flight search failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return mapFlightShopResponse(data, 5);
}

function mapFlightShopResponse(data, max) {
  const offers = [];
  for (const offer of data.offers ?? []) {
    const price = offer.price ?? {};
    offers.push({
      id: offer.offerId || String(Math.random()),
      source: "SABRE",
      itineraries: offer.journeys ?? [],
      price: {
        total: String(price.total ?? price.totalPrice ?? "0"),
        currency: price.currency ?? "USD",
      },
    });
    if (offers.length >= max) break;
  }
  return offers;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLowestPrice(offers) {
  if (!offers || offers.length === 0) return null;
  let lowest = Infinity;
  let lowestOfferId = null;
  for (const offer of offers) {
    // Sabre price is under offer.price.total
    const price = parseFloat(offer?.price?.total || "Infinity");
    if (price < lowest) {
      lowest = price;
      lowestOfferId = offer.id;
    }
  }
  return lowest === Infinity ? null : { price: lowest, offerId: lowestOfferId };
}

function getDepartureDatePlus30() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

// ─── DynamoDB helpers ─────────────────────────────────────────────────────────

async function scanAllActiveAlerts() {
  const items = [];
  let lastKey;
  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: priceAlertsTable,
        FilterExpression: "#s = :active",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":active": "active" },
        ExclusiveStartKey: lastKey,
      })
    );
    items.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function scanConfirmedAutoRebookBookings() {
  const items = [];
  let lastKey;
  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: bookingsTable,
        FilterExpression: "#s = :confirmed AND autoRebook = :true",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":confirmed": "confirmed", ":true": true },
        ExclusiveStartKey: lastKey,
      })
    );
    items.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function getCachedPrice(routeKey) {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: flightsTable,
        Key: { id: `priceCache#${routeKey}` },
      })
    );
    const item = result.Item;
    if (!item?.priceCache) return null;
    const cachedAt = new Date(item.priceCache.cachedAt).getTime();
    const ageMs = Date.now() - cachedAt;
    // Valid if within 5 minutes
    if (ageMs <= 5 * 60 * 1000) {
      return item.priceCache;
    }
    return null;
  } catch {
    return null;
  }
}

async function storePriceCache(routeKey, price, offerId) {
  await docClient.send(
    new PutCommand({
      TableName: flightsTable,
      Item: {
        id: `priceCache#${routeKey}`,
        priceCache: {
          price,
          offerId,
          cachedAt: new Date().toISOString(),
          routeKey,
        },
      },
    })
  );
}

async function getFlightOriginalPrice(flightId) {
  try {
    const result = await docClient.send(
      new GetCommand({ TableName: flightsTable, Key: { id: flightId } })
    );
    return result.Item?.price ?? null;
  } catch {
    return null;
  }
}

// ─── Lambda invocations ───────────────────────────────────────────────────────

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
      JSON.stringify({ correlationId, detail: "notification-worker invoke failed", error: err.message })
    );
  }
}

async function invokeRebookingEngine(payload, correlationId) {
  try {
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: rebookingEngineFn,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify({ ...payload, correlationId })),
      })
    );
  } catch (err) {
    console.error(
      JSON.stringify({ correlationId, detail: "rebooking-engine invoke failed", error: err.message })
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
        Namespace: "FareMonitor",
        MetricData: metricData,
      })
    );
  } catch (err) {
    console.error(JSON.stringify({ detail: "CloudWatch metrics publish failed", error: err.message }));
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export const handler = async (event) => {
  const correlationId = event?.correlationId || randomUUID();
  const startTime = Date.now();
  let alertsEvaluated = 0;
  let rebookingsTriggered = 0;
  let pollSuccess = false;

  try {
    // ── Sub-task 13.1: Core polling logic ─────────────────────────────────────

    // 1. Scan all active price alerts
    const activeAlerts = await scanAllActiveAlerts();

    // 2. Group alerts by routeKey to minimize Amadeus API calls
    const alertsByRoute = new Map();
    for (const alert of activeAlerts) {
      const key = alert.routeKey;
      if (!alertsByRoute.has(key)) alertsByRoute.set(key, []);
      alertsByRoute.get(key).push(alert);
    }

    // Price results keyed by routeKey
    const priceResults = new Map(); // routeKey → { price, offerId } | null

    const departureDate = getDepartureDatePlus30();

    // 3. For each unique routeKey, fetch price from Amadeus (or cache)
    for (const [routeKey] of alertsByRoute) {
      // 3a. Parse origin and destination
      const parts = routeKey.split("#");
      if (parts.length !== 2) {
        console.warn(JSON.stringify({ correlationId, detail: "Invalid routeKey format", routeKey }));
        priceResults.set(routeKey, null);
        continue;
      }
      const [origin, destination] = parts;

      let priceResult = null;
      try {
        // 3b–3d. Call Sabre and get lowest price
        const offers = await searchFlightOffers(origin, destination, departureDate);
        priceResult = getLowestPrice(offers);

        if (priceResult) {
          // 3e. Cache result in airline-flights
          await storePriceCache(routeKey, priceResult.price, priceResult.offerId);
        }
      } catch (sabreErr) {
        console.error(
          JSON.stringify({
            correlationId,
            detail: "Sabre search failed, attempting cache fallback",
            routeKey,
            error: sabreErr.message,
          })
        );
        // 3f. Fallback to cached price if Sabre is unavailable
        const cached = await getCachedPrice(routeKey);
        if (cached) {
          priceResult = { price: cached.price, offerId: cached.offerId };
        }
      }

      priceResults.set(routeKey, priceResult);
    }

    // ── Sub-task 13.2: Alert evaluation and rebooking trigger ─────────────────

    // 4. Evaluate each active alert
    for (const [routeKey, alerts] of alertsByRoute) {
      const priceResult = priceResults.get(routeKey);
      if (!priceResult) continue;

      for (const alert of alerts) {
        alertsEvaluated++;

        // If currentPrice <= alert.threshold → invoke notification-worker with fare_drop
        if (priceResult.price <= alert.threshold) {
          await invokeNotificationWorker(
            {
              userId: alert.userId,
              type: "fare_drop",
              message: `Fare drop detected on ${routeKey}: current price $${priceResult.price.toFixed(2)} is at or below your alert threshold of $${alert.threshold.toFixed(2)}.`,
              metadata: {
                alertId: alert.alertId,
                routeKey,
                currentPrice: priceResult.price,
                threshold: alert.threshold,
                offerId: priceResult.offerId,
              },
            },
            correlationId
          );

          // Update alert lastCheckedAt
          try {
            await docClient.send(
              new UpdateCommand({
                TableName: priceAlertsTable,
                Key: { userId: alert.userId, alertId: alert.alertId },
                UpdateExpression: "SET lastCheckedAt = :now",
                ExpressionAttributeValues: { ":now": new Date().toISOString() },
              })
            );
          } catch (updateErr) {
            console.error(
              JSON.stringify({ correlationId, detail: "Failed to update alert lastCheckedAt", error: updateErr.message })
            );
          }
        }
      }
    }

    // 5. Scan confirmed bookings with autoRebook = true
    const autoRebookBookings = await scanConfirmedAutoRebookBookings();

    // 6. For each such booking: check if currentPrice <= originalPrice * 0.9
    for (const booking of autoRebookBookings) {
      const flightId = booking.flightId;
      if (!flightId) continue;

      // Determine routeKey for this booking's flight
      // Try to get flight record to find route info
      let flightRouteKey = null;
      try {
        const flightResult = await docClient.send(
          new GetCommand({ TableName: flightsTable, Key: { id: flightId } })
        );
        const flight = flightResult.Item;
        if (flight?.from && flight?.to) {
          flightRouteKey = `${flight.from}#${flight.to}`;
        }
      } catch {
        continue;
      }

      if (!flightRouteKey) continue;

      const priceResult = priceResults.get(flightRouteKey);
      if (!priceResult) continue;

      const originalPrice = await getFlightOriginalPrice(flightId);
      if (originalPrice == null) continue;

      // 7. If currentPrice <= originalPrice * 0.9 → invoke rebooking-engine
      if (priceResult.price <= originalPrice * 0.9) {
        rebookingsTriggered++;
        await invokeRebookingEngine(
          {
            bookingId: booking.id,
            replacementFlightId: priceResult.offerId,
            trigger: "auto",
          },
          correlationId
        );
      }
    }

    pollSuccess = true;

    // ── Sub-task 13.3: CloudWatch metrics and logging ─────────────────────────

    await publishMetrics([
      { name: "PollSuccess", value: 1 },
      { name: "AlertsEvaluated", value: alertsEvaluated },
      { name: "RebookingsTriggered", value: rebookingsTriggered },
    ]);
  } catch (err) {
    console.error(
      JSON.stringify({
        correlationId,
        detail: "fare-monitor handler error",
        error: err.message,
        stack: err.stack,
      })
    );

    await publishMetrics([{ name: "PollFailure", value: 1 }]);

    throw err;
  } finally {
    const duration = Date.now() - startTime;
    // 9. Emit structured JSON log
    console.log(
      JSON.stringify({
        correlationId,
        duration,
        alertsEvaluated,
        rebookingsTriggered,
        status: pollSuccess ? "success" : "error",
      })
    );
  }
};
