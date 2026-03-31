const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");

const region = process.env.AWS_REGION || "us-east-2";
const flightsTable = process.env.FLIGHTS_TABLE || "airline-flights";
const seatsTable = process.env.SEATS_TABLE || "airline-seats";
const bookingsTable = process.env.BOOKINGS_TABLE || "airline-bookings";

const client = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(client);

function response(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function isValidDate(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }
function isValidTime(t) { return /^\d{2}:\d{2}$/.test(t); }

async function handleReschedule(flightId, body) {
  const { date, departureTime, arrivalTime } = body;

  if (!date || !departureTime || !arrivalTime) {
    return response(400, { message: "date, departureTime, and arrivalTime are required." });
  }
  if (!isValidDate(date)) return response(400, { message: "Invalid date format. Use YYYY-MM-DD." });
  if (!isValidTime(departureTime)) return response(400, { message: "Invalid departureTime format. Use HH:MM." });
  if (!isValidTime(arrivalTime)) return response(400, { message: "Invalid arrivalTime format. Use HH:MM." });

  try {
    const result = await docClient.send(new UpdateCommand({
      TableName: flightsTable,
      Key: { id: flightId },
      ConditionExpression: "attribute_exists(id)",
      UpdateExpression: "SET #date = :date, departureTime = :dep, arrivalTime = :arr",
      ExpressionAttributeNames: { "#date": "date" },
      ExpressionAttributeValues: { ":date": date, ":dep": departureTime, ":arr": arrivalTime },
      ReturnValues: "ALL_NEW",
    }));
    const item = { ...result.Attributes };
    delete item.route;
    return response(200, item);
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      return response(404, { message: "Flight not found." });
    }
    throw err;
  }
}

async function handleCancel(flightId) {
  const existing = await docClient.send(new GetCommand({ TableName: flightsTable, Key: { id: flightId } }));
  if (!existing.Item) return response(404, { message: "Flight not found." });
  if (existing.Item.status === "cancelled") return response(400, { message: "Flight is already cancelled." });

  // Block all non-blocked seats
  const seatsResult = await docClient.send(new QueryCommand({
    TableName: seatsTable,
    KeyConditionExpression: "flightId = :fid",
    ExpressionAttributeValues: { ":fid": flightId },
  }));
  for (const seat of (seatsResult.Items || [])) {
    if (seat.status !== "blocked") {
      await docClient.send(new UpdateCommand({
        TableName: seatsTable,
        Key: { flightId, seatNumber: seat.seatNumber },
        UpdateExpression: "SET #s = :blocked REMOVE bookingId",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":blocked": "blocked" },
      }));
    }
  }

  // Cancel confirmed bookings
  const bookingsResult = await docClient.send(new ScanCommand({
    TableName: bookingsTable,
    FilterExpression: "flightId = :fid AND #s = :confirmed",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":fid": flightId, ":confirmed": "confirmed" },
  }));
  for (const booking of (bookingsResult.Items || [])) {
    await docClient.send(new UpdateCommand({
      TableName: bookingsTable,
      Key: { id: booking.id },
      UpdateExpression: "SET #s = :cancelled",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":cancelled": "cancelled" },
    }));
  }

  // Mark flight cancelled
  const updated = await docClient.send(new UpdateCommand({
    TableName: flightsTable,
    Key: { id: flightId },
    UpdateExpression: "SET #s = :cancelled",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":cancelled": "cancelled" },
    ReturnValues: "ALL_NEW",
  }));
  const item = { ...updated.Attributes };
  delete item.route;
  return response(200, item);
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  const flightId = event.pathParameters?.flightId;

  if (!flightId) return response(400, { message: "flightId is required." });

  const body = event.body ? JSON.parse(event.body) : {};

  if (method === "PATCH") return handleReschedule(flightId, body);
  if (method === "DELETE") return handleCancel(flightId);

  return response(405, { message: "Method not allowed." });
};
