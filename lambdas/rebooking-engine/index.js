import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { randomUUID } from "crypto";

const region = process.env.AWS_REGION || "us-east-2";
const bookingsTable = process.env.DDB_BOOKINGS_TABLE || "airline-bookings";
const flightsTable = process.env.DDB_FLIGHTS_TABLE || "airline-flights";
const seatsTable = process.env.DDB_SEATS_TABLE || "airline-seats";
const usersTable = process.env.DDB_USERS_TABLE || "airline-users";
const rebookingHistoryTable = process.env.DDB_REBOOKING_HISTORY_TABLE || "airline-rebooking-history";
const loyaltyTransactionsTable = process.env.DDB_LOYALTY_TRANSACTIONS_TABLE || "airline-loyalty-transactions";
const notificationWorkerFn = process.env.NOTIFICATION_WORKER_FUNCTION_NAME || "notification-worker";

const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);
const lambdaClient = new LambdaClient({ region });

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getItem(tableName, key) {
  const result = await docClient.send(new GetCommand({ TableName: tableName, Key: key }));
  return result.Item || null;
}

async function invokeNotificationWorker(payload) {
  try {
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: notificationWorkerFn,
        InvocationType: "Event", // async fire-and-forget
        Payload: Buffer.from(JSON.stringify(payload)),
      })
    );
  } catch (err) {
    // Non-fatal — log and continue
    console.error(JSON.stringify({ detail: "notification-worker invoke failed", error: err.message }));
  }
}

// ─── Sub-task 11.1 + 11.2: Rebook ───────────────────────────────────────────

async function rebook(bookingId, replacementFlightId, trigger, correlationId) {
  // 1. Load original booking
  const booking = await getItem(bookingsTable, { id: bookingId });
  if (!booking) {
    return { success: false, reason: "booking_not_found" };
  }

  // 2. Check autoRebook flag
  if (booking.autoRebook === false && trigger === "auto") {
    return { success: false, reason: "auto_rebook_disabled" };
  }

  // 3. Load replacement flight
  const replacementFlight = await getItem(flightsTable, { id: replacementFlightId });
  if (!replacementFlight) {
    return { success: false, reason: "replacement_flight_not_found" };
  }

  // 4. Verify available seats
  if (!replacementFlight.availableSeats || replacementFlight.availableSeats <= 0) {
    // 5. No seats — notify fare drop instead
    await invokeNotificationWorker({
      correlationId,
      userId: booking.userId,
      type: "fare_drop",
      message: `A lower fare is available for flight ${replacementFlightId}, but no seats are currently open.`,
      metadata: { bookingId, replacementFlightId },
    });
    return { success: false, reason: "no_seats_available" };
  }

  // Load original flight for fare comparison
  const originalFlight = await getItem(flightsTable, { id: booking.flightId });

  const passengers = booking.passengers || [];
  const passengerCount = passengers.length;
  const newBookingId = `BK-${randomUUID().slice(0, 8).toUpperCase()}`;
  const now = new Date().toISOString();

  // 6. DynamoDB TransactWrite
  const transactItems = [
    // Cancel original booking
    {
      Update: {
        TableName: bookingsTable,
        Key: { id: bookingId },
        UpdateExpression: "SET #status = :cancelled",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":cancelled": "cancelled" },
      },
    },
    // Release original seats
    ...passengers.map((p) => ({
      Update: {
        TableName: seatsTable,
        Key: { flightId: booking.flightId, seatNumber: p.seatNumber },
        UpdateExpression: "SET #status = :available REMOVE bookingId",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":available": "available" },
      },
    })),
    // Create new booking
    {
      Put: {
        TableName: bookingsTable,
        Item: {
          id: newBookingId,
          flightId: replacementFlightId,
          userId: booking.userId,
          passengers,
          status: "confirmed",
          createdAt: now,
          autoRebook: booking.autoRebook ?? false,
        },
        ConditionExpression: "attribute_not_exists(id)",
      },
    },
    // Reserve new seats
    ...passengers.map((p) => ({
      Update: {
        TableName: seatsTable,
        Key: { flightId: replacementFlightId, seatNumber: p.seatNumber },
        UpdateExpression: "SET #status = :reserved, bookingId = :newBookingId",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":reserved": "reserved",
          ":newBookingId": newBookingId,
        },
      },
    })),
    // Decrement availableSeats on replacement flight
    {
      Update: {
        TableName: flightsTable,
        Key: { id: replacementFlightId },
        ConditionExpression: "availableSeats >= :count",
        UpdateExpression: "SET availableSeats = availableSeats - :count",
        ExpressionAttributeValues: { ":count": passengerCount },
      },
    },
  ];

  await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));

  // 7. Write RebookingHistory
  const fareSaved = originalFlight && replacementFlight
    ? Math.max(0, (originalFlight.price || 0) - (replacementFlight.price || 0))
    : 0;

  await docClient.send(
    new PutCommand({
      TableName: rebookingHistoryTable,
      Item: {
        userId: booking.userId,
        timestamp: now,
        originalBookingId: bookingId,
        newBookingId,
        fareSaved,
        trigger,
      },
    })
  );

  // ── Sub-task 11.2: Post-rebook loyalty and notification ──────────────────

  // 8–10. Credit loyalty points if fare was saved
  if (fareSaved > 0) {
    const loyaltyDelta = Math.floor(fareSaved * 5);
    const transactionId = randomUUID();

    // Update user loyaltyPoints
    await docClient.send(
      new UpdateCommand({
        TableName: usersTable,
        Key: { id: booking.userId },
        UpdateExpression: "SET loyaltyPoints = if_not_exists(loyaltyPoints, :zero) + :delta",
        ExpressionAttributeValues: { ":zero": 0, ":delta": loyaltyDelta },
      })
    );

    // Write LoyaltyTransaction
    await docClient.send(
      new PutCommand({
        TableName: loyaltyTransactionsTable,
        Item: {
          userId: booking.userId,
          transactionId,
          type: "rebooking_saving",
          points: loyaltyDelta,
          referenceId: newBookingId,
          timestamp: now,
        },
      })
    );
  }

  // 11. Invoke notification-worker with rebooking_confirmed
  await invokeNotificationWorker({
    correlationId,
    userId: booking.userId,
    type: "rebooking_confirmed",
    message: `Your booking has been moved from flight ${booking.flightId} to ${replacementFlightId}. Fare saved: $${fareSaved.toFixed(2)}.`,
    metadata: {
      originalBookingId: bookingId,
      newBookingId,
      originalFlightId: booking.flightId,
      newFlightId: replacementFlightId,
      fareSaved,
    },
  });

  return { success: true, newBookingId, fareSaved };
}

// ─── Sub-task 11.3: Cancel / Refund ─────────────────────────────────────────

async function cancelBooking(bookingId, correlationId) {
  // 12. Load booking and flight
  const booking = await getItem(bookingsTable, { id: bookingId });
  if (!booking) {
    return { success: false, reason: "booking_not_found" };
  }

  const flight = await getItem(flightsTable, { id: booking.flightId });

  // 13. Calculate refund
  const departureMs = flight ? new Date(flight.date + "T" + (flight.departureTime || "00:00")).getTime() : 0;
  const hoursUntilDeparture = (departureMs - Date.now()) / (1000 * 60 * 60);
  const passengerCount = (booking.passengers || []).length || 1;
  const basePrice = (flight?.price || 0) * passengerCount;
  const isFullRefund = hoursUntilDeparture >= 24;
  const baseFareRefund = isFullRefund ? basePrice : basePrice * 0.5;

  // 14. Include ancillary charges
  const ancillaryTotal = (booking.ancillaries || []).reduce((sum, a) => sum + (a.price || 0), 0);
  const totalRefund = baseFareRefund + ancillaryTotal;

  // 15–16. Retry refund up to 3 times
  let refundProcessed = false;
  let lastError = null;
  const refundReference = randomUUID();
  const refundTimestamp = new Date().toISOString();

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Write refund to booking record and mark as cancelled
      await docClient.send(
        new UpdateCommand({
          TableName: bookingsTable,
          Key: { id: bookingId },
          UpdateExpression:
            "SET #status = :cancelled, refund = :refund, refundProcessed = :processed",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":cancelled": "cancelled",
            ":refund": {
              amount: totalRefund,
              timestamp: refundTimestamp,
              reference: refundReference,
            },
            ":processed": true,
          },
        })
      );
      refundProcessed = true;
      break;
    } catch (err) {
      lastError = err;
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  // 16. After 3 failures: set manualReview
  if (!refundProcessed) {
    console.error(
      JSON.stringify({
        correlationId,
        bookingId,
        refundAmount: totalRefund,
        error: lastError?.message,
        detail: "Refund failed after 3 attempts — marking manualReview",
      })
    );
    await docClient.send(
      new UpdateCommand({
        TableName: bookingsTable,
        Key: { id: bookingId },
        UpdateExpression: "SET manualReview = :true",
        ExpressionAttributeValues: { ":true": true },
      })
    );
    return { success: false, reason: "refund_failed", manualReview: true };
  }

  // 18. Invoke notification-worker with refund payload
  await invokeNotificationWorker({
    correlationId,
    userId: booking.userId,
    type: "refund",
    message: `Your booking ${bookingId} has been cancelled. A refund of $${totalRefund.toFixed(2)} has been processed (reference: ${refundReference}).`,
    metadata: {
      bookingId,
      refundAmount: totalRefund,
      refundReference,
      isFullRefund,
    },
  });

  return {
    success: true,
    refundAmount: totalRefund,
    refundReference,
    isFullRefund,
  };
}

// ─── Main handler ────────────────────────────────────────────────────────────

export const handler = async (event) => {
  const correlationId = event.correlationId || randomUUID();
  const startTime = Date.now();

  try {
    let result;

    if (event.action === "cancel") {
      // Sub-task 11.3: cancellation path
      const { bookingId } = event;
      if (!bookingId) {
        result = { success: false, reason: "bookingId_required" };
      } else {
        result = await cancelBooking(bookingId, correlationId);
      }
    } else {
      // Sub-tasks 11.1 + 11.2: rebook path
      const { bookingId, replacementFlightId, trigger = "manual" } = event;
      if (!bookingId || !replacementFlightId) {
        result = { success: false, reason: "bookingId_and_replacementFlightId_required" };
      } else {
        result = await rebook(bookingId, replacementFlightId, trigger, correlationId);
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      JSON.stringify({
        correlationId,
        action: event.action || "rebook",
        bookingId: event.bookingId,
        duration,
        result,
      })
    );

    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(
      JSON.stringify({
        correlationId,
        action: event.action || "rebook",
        bookingId: event.bookingId,
        error: err.message,
        duration,
      })
    );
    throw err;
  }
};
