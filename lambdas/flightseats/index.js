const AWS = require("aws-sdk");

const ddb = new AWS.DynamoDB.DocumentClient();
const flightsTable = process.env.FLIGHTS_TABLE;
const seatsTable = process.env.SEATS_TABLE;

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
  const flightId = event.pathParameters && event.pathParameters.flightId;
  if (!flightId) {
    return response(400, { message: "flightId is required." });
  }

  try {
    if (event.requestContext.http.method === "GET") {
      const flightResult = await ddb
        .get({
          TableName: flightsTable,
          Key: { id: flightId },
        })
        .promise();
      if (!flightResult.Item) {
        return response(404, { message: "Flight not found." });
      }

      const seatsResult = await ddb
        .query({
          TableName: seatsTable,
          KeyConditionExpression: "flightId = :flightId",
          ExpressionAttributeValues: { ":flightId": flightId },
        })
        .promise();

      const { route, ...flight } = flightResult.Item;
      return response(200, { flight, seats: seatsResult.Items || [] });
    }

    if (event.requestContext.http.method === "PATCH") {
      const body = JSON.parse(event.body || "{}");
      if (!body.seatNumber || !body.status) {
        return response(400, { message: "seatNumber and status are required." });
      }

      const updated = await ddb
        .update({
          TableName: seatsTable,
          Key: { flightId, seatNumber: body.seatNumber },
          ConditionExpression: "attribute_exists(flightId) AND attribute_exists(seatNumber)",
          UpdateExpression: "SET #status = :status REMOVE bookingId",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":status": body.status },
          ReturnValues: "ALL_NEW",
        })
        .promise();

      return response(200, updated.Attributes || {});
    }

    return response(405, { message: "Method not allowed." });
  } catch (error) {
    if (error && error.code === "ConditionalCheckFailedException") {
      return response(404, { message: "Seat or flight not found." });
    }
    return response(500, { message: "Seat operation failed.", detail: String(error) });
  }
};
