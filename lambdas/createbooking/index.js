const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require("@aws-sdk/lib-dynamodb");
const crypto = require("crypto");

const region = process.env.AWS_REGION || "us-east-2";
const flightsTable = process.env.FLIGHTS_TABLE || "airline-flights";
const seatsTable = process.env.SEATS_TABLE || "airline-seats";
const bookingsTable = process.env.BOOKINGS_TABLE || "airline-bookings";

const client = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(client);

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { flightId, userId, passengers } = body;

    if (!flightId) {
      return response(400, { message: "flightId is required." });
    }
    if (!Array.isArray(passengers) || passengers.length === 0) {
      return response(400, { message: "passengers must be a non-empty array." });
    }
    for (const [i, p] of passengers.entries()) {
      if (!p.seatNumber || !p.passengerName || !p.passengerEmail) {
        return response(400, {
          message: `Passenger ${i + 1}: seatNumber, passengerName, and passengerEmail are required.`,
        });
      }
    }

    // Check flight exists and has enough seats
    const flightResult = await docClient.send(
      new GetCommand({ TableName: flightsTable, Key: { id: flightId } })
    );
    if (!flightResult.Item) {
      return response(404, { message: "Flight not found." });
    }
    if (flightResult.Item.availableSeats < passengers.length) {
      return response(400, { message: "Not enough available seats for this booking." });
    }

    const bookingId = `BK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const booking = {
      id: bookingId,
      flightId,
      userId: userId || "guest",
      passengers: passengers.map((p) => ({
        seatNumber: p.seatNumber,
        passengerName: p.passengerName.trim(),
        passengerEmail: p.passengerEmail.trim().toLowerCase(),
      })),
      status: "confirmed",
      createdAt: new Date().toISOString(),
    };

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // Reserve each seat
          ...passengers.map((p) => ({
            Update: {
              TableName: seatsTable,
              Key: { flightId, seatNumber: p.seatNumber },
              ConditionExpression: "#status = :available",
              UpdateExpression: "SET #status = :reserved, bookingId = :bookingId",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":available": "available",
                ":reserved": "reserved",
                ":bookingId": bookingId,
              },
            },
          })),
          // Decrement availableSeats
          {
            Update: {
              TableName: flightsTable,
              Key: { id: flightId },
              ConditionExpression: "availableSeats >= :count",
              UpdateExpression: "SET availableSeats = availableSeats - :count",
              ExpressionAttributeValues: { ":count": passengers.length },
            },
          },
          // Create booking record
          {
            Put: {
              TableName: bookingsTable,
              Item: booking,
              ConditionExpression: "attribute_not_exists(id)",
            },
          },
        ],
      })
    );

    return response(201, booking);
  } catch (error) {
    if (error?.name === "TransactionCanceledException") {
      return response(400, { message: "One or more seats are not available." });
    }
    return response(500, { message: "Booking failed.", detail: String(error) });
  }
};
