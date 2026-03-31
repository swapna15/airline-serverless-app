const AWS = require("aws-sdk");

const ddb = new AWS.DynamoDB.DocumentClient();
const flightsTable = process.env.FLIGHTS_TABLE;
const seatsTable = process.env.SEATS_TABLE;
const routeDateIndex = "route-date-index";

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

async function seedIfNeeded() {
  const countRes = await ddb
    .scan({
      TableName: flightsTable,
      Select: "COUNT",
      Limit: 1,
    })
    .promise();

  if ((countRes.Count || 0) > 0) {
    return;
  }

  const flights = [
    {
      id: "FL-1001",
      from: "ORD",
      to: "JFK",
      date: "2026-04-10",
      departureTime: "08:30",
      arrivalTime: "11:20",
      price: 220,
      totalSeats: 24,
      availableSeats: 24,
      route: "ORD#JFK",
    },
    {
      id: "FL-1002",
      from: "SFO",
      to: "LAX",
      date: "2026-04-10",
      departureTime: "09:00",
      arrivalTime: "10:35",
      price: 140,
      totalSeats: 24,
      availableSeats: 24,
      route: "SFO#LAX",
    },
    {
      id: "FL-1003",
      from: "SEA",
      to: "DEN",
      date: "2026-04-11",
      departureTime: "14:15",
      arrivalTime: "17:05",
      price: 180,
      totalSeats: 24,
      availableSeats: 24,
      route: "SEA#DEN",
    },
  ];

  const seatLabels = ["A", "B", "C", "D", "E", "F"];

  for (const flight of flights) {
    await ddb.put({ TableName: flightsTable, Item: flight }).promise();

    let seatCount = 0;
    for (let row = 1; seatCount < flight.totalSeats; row += 1) {
      for (const label of seatLabels) {
        if (seatCount >= flight.totalSeats) {
          break;
        }
        seatCount += 1;
        await ddb
          .put({
            TableName: seatsTable,
            Item: {
              flightId: flight.id,
              seatNumber: `${row}${label}`,
              status: "available",
            },
          })
          .promise();
      }
    }
  }
}

exports.handler = async (event) => {
  try {
    await seedIfNeeded();
    const query = event.queryStringParameters || {};
    const from = query.from ? query.from.toUpperCase() : undefined;
    const to = query.to ? query.to.toUpperCase() : undefined;
    const date = query.date;

    let items = [];

    if (from && to) {
      const result = await ddb
        .query({
          TableName: flightsTable,
          IndexName: routeDateIndex,
          KeyConditionExpression: "#route = :route",
          ExpressionAttributeNames: { "#route": "route" },
          ExpressionAttributeValues: { ":route": `${from}#${to}` },
        })
        .promise();
      items = result.Items || [];
    } else {
      const result = await ddb.scan({ TableName: flightsTable }).promise();
      items = result.Items || [];
    }

    const filtered = items
      .filter((f) => (from ? f.from === from : true))
      .filter((f) => (to ? f.to === to : true))
      .filter((f) => (date ? f.date === date : true))
      .map(({ route, ...flight }) => flight);

    return response(200, filtered);
  } catch (error) {
    return response(500, { message: "Failed to search flights.", detail: String(error) });
  }
};
