const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");

const region = process.env.AWS_REGION || "us-east-2";
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
    const bookingId = event.pathParameters?.bookingId;
    if (!bookingId) {
      return response(400, { message: "bookingId is required." });
    }

    const result = await docClient.send(
      new GetCommand({ TableName: bookingsTable, Key: { id: bookingId } })
    );

    if (!result.Item) {
      return response(404, { message: "Booking not found." });
    }

    return response(200, result.Item);
  } catch (error) {
    return response(500, { message: "Failed to fetch booking.", detail: String(error) });
  }
};
