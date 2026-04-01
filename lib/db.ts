import {
  DynamoDBClient,
  ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { Booking, BookingPassenger, Flight, LoyaltyTransaction, NotificationLog, PriceAlert, RebookingHistory, Seat, SeatStatus, User } from "@/lib/types";

const region = process.env.AWS_REGION || "us-east-2";
const flightsTable = process.env.DDB_FLIGHTS_TABLE || "airline-flights";
const seatsTable = process.env.DDB_SEATS_TABLE || "airline-seats";
const bookingsTable = process.env.DDB_BOOKINGS_TABLE || "airline-bookings";
const usersTable = process.env.DDB_USERS_TABLE || "airline-users";
const priceAlertsTable = process.env.DDB_PRICE_ALERTS_TABLE || 'airline-price-alerts';
const rebookingHistoryTable = process.env.DDB_REBOOKING_HISTORY_TABLE || 'airline-rebooking-history';
const loyaltyTransactionsTable = process.env.DDB_LOYALTY_TRANSACTIONS_TABLE || 'airline-loyalty-transactions';
const notificationLogTable = process.env.DDB_NOTIFICATION_LOG_TABLE || 'airline-notification-log';
const flightsRouteDateIndex = "route-date-index";

const client = new DynamoDBClient({ region });
export const docClient = DynamoDBDocumentClient.from(client);

const rowLabels = ["A", "B", "C", "D", "E", "F"];
let seedAttempted = false;

type FlightRecord = Flight & { route: string };

const seedFlights: Flight[] = [
  {
    id: "FL-1001",
    from: "ORD",
    to: "JFK",
    date: "2026-06-15",
    departureTime: "08:30",
    arrivalTime: "11:20",
    price: 220,
    totalSeats: 24,
    availableSeats: 24,
  },
  {
    id: "FL-1002",
    from: "SFO",
    to: "LAX",
    date: "2026-06-15",
    departureTime: "09:00",
    arrivalTime: "10:35",
    price: 140,
    totalSeats: 24,
    availableSeats: 24,
  },
  {
    id: "FL-1003",
    from: "SEA",
    to: "DEN",
    date: "2026-06-16",
    departureTime: "14:15",
    arrivalTime: "17:05",
    price: 180,
    totalSeats: 24,
    availableSeats: 24,
  },
  {
    id: "FL-1004",
    from: "ORD",
    to: "LAX",
    date: "2026-06-15",
    departureTime: "11:00",
    arrivalTime: "13:45",
    price: 195,
    totalSeats: 24,
    availableSeats: 24,
  },
  {
    id: "FL-1005",
    from: "JFK",
    to: "ORD",
    date: "2026-06-17",
    departureTime: "07:00",
    arrivalTime: "09:50",
    price: 210,
    totalSeats: 24,
    availableSeats: 24,
  },
];

function createSeatMap(totalSeats: number): Seat[] {
  const seatMap: Seat[] = [];
  const rows = Math.ceil(totalSeats / rowLabels.length);
  for (let row = 1; row <= rows; row += 1) {
    for (const label of rowLabels) {
      if (seatMap.length >= totalSeats) {
        break;
      }
      seatMap.push({ seatNumber: `${row}${label}`, status: "available" });
    }
  }
  return seatMap;
}

function toFlightRecord(flight: Flight): FlightRecord {
  return {
    ...flight,
    route: `${flight.from}#${flight.to}`,
  };
}

async function seedIfNeeded() {
  if (seedAttempted) {
    return;
  }
  seedAttempted = true;

  const existing = await docClient.send(
    new ScanCommand({
      TableName: flightsTable,
      Select: "COUNT",
      Limit: 1,
    })
  );
  if ((existing.Count ?? 0) > 0) {
    return;
  }

  for (const flight of seedFlights) {
    await docClient.send(
      new PutCommand({
        TableName: flightsTable,
        Item: toFlightRecord(flight),
      })
    );

    for (const seat of createSeatMap(flight.totalSeats)) {
      await docClient.send(
        new PutCommand({
          TableName: seatsTable,
          Item: {
            flightId: flight.id,
            seatNumber: seat.seatNumber,
            status: seat.status,
          },
        })
      );
    }
  }
}

function normalizeFlight(record: FlightRecord): Flight {
  const { route: _route, ...flight } = record;
  void _route;
  return flight;
}

export async function getFlights(filters?: {
  from?: string;
  to?: string;
  date?: string;
}): Promise<Flight[]> {
  await seedIfNeeded();

  const from = filters?.from?.toUpperCase();
  const to = filters?.to?.toUpperCase();
  const date = filters?.date;

  if (from && to) {
    const query = await docClient.send(
      new QueryCommand({
        TableName: flightsTable,
        IndexName: flightsRouteDateIndex,
        KeyConditionExpression: "#route = :routeValue",
        ExpressionAttributeNames: { "#route": "route" },
        ExpressionAttributeValues: { ":routeValue": `${from}#${to}` },
      })
    );
    const items = (query.Items ?? []) as FlightRecord[];
    return items
      .filter((item) => (date ? item.date === date : true))
      .map(normalizeFlight);
  }

  const scan = await docClient.send(
    new ScanCommand({
      TableName: flightsTable,
    })
  );

  const items = (scan.Items ?? []) as FlightRecord[];
  return items
    .filter((flight) => (from ? flight.from === from : true))
    .filter((flight) => (to ? flight.to === to : true))
    .filter((flight) => (date ? flight.date === date : true))
    .map(normalizeFlight);
}

export async function getFlightById(flightId: string): Promise<Flight | undefined> {
  await seedIfNeeded();
  const result = await docClient.send(
    new GetCommand({
      TableName: flightsTable,
      Key: { id: flightId },
    })
  );
  if (!result.Item) {
    return undefined;
  }
  return normalizeFlight(result.Item as FlightRecord);
}

export async function getSeatsByFlightId(flightId: string): Promise<Seat[]> {
  await seedIfNeeded();
  const result = await docClient.send(
    new QueryCommand({
      TableName: seatsTable,
      KeyConditionExpression: "flightId = :flightId",
      ExpressionAttributeValues: {
        ":flightId": flightId,
      },
    })
  );
  return (result.Items ?? []) as Seat[];
}

export async function updateSeatStatus(
  flightId: string,
  seatNumber: string,
  status: SeatStatus
): Promise<Seat | undefined> {
  await seedIfNeeded();

  const result = await docClient.send(
    new UpdateCommand({
      TableName: seatsTable,
      Key: { flightId, seatNumber },
      ConditionExpression: "attribute_exists(flightId) AND attribute_exists(seatNumber)",
      UpdateExpression: "SET #status = :status REMOVE bookingId",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": status },
      ReturnValues: "ALL_NEW",
    })
  );

  return result.Attributes as Seat | undefined;
}

export async function createBooking(data: {
  flightId: string;
  userId: string;
  passengers: BookingPassenger[];
}): Promise<{ booking?: Booking; message?: string }> {
  await seedIfNeeded();

  const flight = await getFlightById(data.flightId);
  if (!flight) return { message: "Flight not found." };
  if (flight.availableSeats < data.passengers.length) {
    return { message: "Not enough available seats for this booking." };
  }

  const bookingId = `BK-${randomUUID().slice(0, 8).toUpperCase()}`;
  const booking: Booking = {
    id: bookingId,
    flightId: data.flightId,
    userId: data.userId,
    passengers: data.passengers.map((p) => ({
      seatNumber: p.seatNumber,
      passengerName: p.passengerName.trim(),
      passengerEmail: p.passengerEmail.trim().toLowerCase(),
    })),
    status: "confirmed",
    createdAt: new Date().toISOString(),
    autoRebook: false,
  };

  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // Reserve each seat
          ...data.passengers.map((p) => ({
            Update: {
              TableName: seatsTable,
              Key: { flightId: data.flightId, seatNumber: p.seatNumber },
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
          // Decrement availableSeats by number of passengers
          {
            Update: {
              TableName: flightsTable,
              Key: { id: data.flightId },
              ConditionExpression: "availableSeats >= :count",
              UpdateExpression: "SET availableSeats = availableSeats - :count",
              ExpressionAttributeValues: {
                ":count": data.passengers.length,
              },
            },
          },
          // Create the booking record
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
  } catch {
    return { message: "One or more seats are not available." };
  }

  return { booking };
}

// ── User management ──────────────────────────────────────────────────────────

export async function createUser(data: {
  name: string;
  email: string;
  passwordHash: string;
}): Promise<{ user?: User; message?: string }> {
  try {
    const existing = await getUserByEmail(data.email);
    if (existing) return { message: "An account with this email already exists." };

    const user: User = {
      id: randomUUID(),
      name: data.name.trim(),
      email: data.email.trim().toLowerCase(),
      passwordHash: data.passwordHash,
      createdAt: new Date().toISOString(),
    };

    await docClient.send(
      new PutCommand({
        TableName: usersTable,
        Item: user,
        ConditionExpression: "attribute_not_exists(id)",
      })
    );

    return { user };
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name ?? "";
    if (name === "ResourceNotFoundException") {
      return { message: "User storage is not available. Please ensure the database is provisioned." };
    }
    console.error("createUser error:", err);
    return { message: "Failed to create account. Please try again." };
  }
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const normalized = email.trim().toLowerCase();
  try {
    // Try GSI first (fast path — requires email-index to exist)
    const result = await docClient.send(
      new QueryCommand({
        TableName: usersTable,
        IndexName: "email-index",
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": normalized },
        Limit: 1,
      })
    );
    return result.Items?.[0] as User | undefined;
  } catch {
    // GSI not provisioned yet — fall back to full scan
    try {
      const scan = await docClient.send(
        new ScanCommand({
          TableName: usersTable,
          FilterExpression: "email = :email",
          ExpressionAttributeValues: { ":email": normalized },
          Limit: 10,
        })
      );
      return scan.Items?.[0] as User | undefined;
    } catch {
      return undefined;
    }
  }
}

export async function getUserById(userId: string): Promise<User | undefined> {
  const result = await docClient.send(
    new GetCommand({ TableName: usersTable, Key: { id: userId } })
  );
  return result.Item as User | undefined;
}

export async function getBookingsByUserId(userId: string): Promise<Booking[]> {
  await seedIfNeeded();
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: bookingsTable,
        IndexName: "userId-index",
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": userId },
      })
    );
    return (result.Items ?? []) as Booking[];
  } catch (err: unknown) {
    // GSI not yet provisioned — fall back to a full scan filtered by userId
    const name = (err as { name?: string })?.name ?? "";
    if (name === "ResourceNotFoundException" || name === "ValidationException") {
      const scan = await docClient.send(
        new ScanCommand({
          TableName: bookingsTable,
          FilterExpression: "userId = :userId",
          ExpressionAttributeValues: { ":userId": userId },
        })
      );
      return (scan.Items ?? []) as Booking[];
    }
    return [];
  }
}


export async function getBookingById(bookingId: string): Promise<Booking | undefined> {
  await seedIfNeeded();

  const result = await docClient.send(
    new GetCommand({
      TableName: bookingsTable,
      Key: { id: bookingId },
    })
  );
  return result.Item as Booking | undefined;
}

export async function updateFlightSchedule(
  flightId: string,
  data: { date: string; departureTime: string; arrivalTime: string }
): Promise<Flight | undefined> {
  await seedIfNeeded();

  const result = await docClient.send(
    new UpdateCommand({
      TableName: flightsTable,
      Key: { id: flightId },
      ConditionExpression: "attribute_exists(id)",
      UpdateExpression: "SET #date = :date, departureTime = :dep, arrivalTime = :arr",
      ExpressionAttributeNames: { "#date": "date" },
      ExpressionAttributeValues: {
        ":date": data.date,
        ":dep": data.departureTime,
        ":arr": data.arrivalTime,
      },
      ReturnValues: "ALL_NEW",
    })
  );

  return result.Attributes ? normalizeFlight(result.Attributes as FlightRecord) : undefined;
}

export async function cancelFlight(flightId: string): Promise<{ flight?: Flight; message?: string }> {
  await seedIfNeeded();

  const flight = await getFlightById(flightId);
  if (!flight) {
    return { message: "Flight not found." };
  }
  if (flight.status === "cancelled") {
    return { message: "Flight is already cancelled." };
  }

  // Update all non-blocked seats to blocked
  const seatsResult = await docClient.send(
    new QueryCommand({
      TableName: seatsTable,
      KeyConditionExpression: "flightId = :flightId",
      ExpressionAttributeValues: { ":flightId": flightId },
    })
  );
  const seats = (seatsResult.Items ?? []) as Seat[];
  for (const seat of seats) {
    if (seat.status !== "blocked") {
      await docClient.send(
        new UpdateCommand({
          TableName: seatsTable,
          Key: { flightId, seatNumber: seat.seatNumber },
          UpdateExpression: "SET #status = :blocked REMOVE bookingId",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":blocked": "blocked" },
        })
      );
    }
  }

  // Cancel all confirmed bookings for this flight
  const bookingsResult = await docClient.send(
    new ScanCommand({
      TableName: bookingsTable,
      FilterExpression: "flightId = :flightId AND #status = :confirmed",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":flightId": flightId, ":confirmed": "confirmed" },
    })
  );
  const bookings = (bookingsResult.Items ?? []) as Booking[];
  for (const booking of bookings) {
    await docClient.send(
      new UpdateCommand({
        TableName: bookingsTable,
        Key: { id: booking.id },
        UpdateExpression: "SET #status = :cancelled",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":cancelled": "cancelled" },
      })
    );
  }

  // Mark flight as cancelled
  const updated = await docClient.send(
    new UpdateCommand({
      TableName: flightsTable,
      Key: { id: flightId },
      UpdateExpression: "SET #status = :cancelled",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":cancelled": "cancelled" },
      ReturnValues: "ALL_NEW",
    })
  );

  return { flight: normalizeFlight(updated.Attributes as FlightRecord) };
}

export async function verifyTables() {
  try {
    await seedIfNeeded();
    return true;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      return false;
    }
    return false;
  }
}

// ── Price Alerts ─────────────────────────────────────────────────────────────

export async function getPriceAlertsByUserId(userId: string): Promise<PriceAlert[]> {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: priceAlertsTable,
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": userId },
      })
    );
    return (result.Items ?? []) as PriceAlert[];
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === "ResourceNotFoundException") return [];
    throw err;
  }
}

export async function getPriceAlertsByRouteKey(routeKey: string): Promise<PriceAlert[]> {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: priceAlertsTable,
        IndexName: "routeKey-index",
        KeyConditionExpression: "routeKey = :routeKey",
        ExpressionAttributeValues: { ":routeKey": routeKey },
      })
    );
    return (result.Items ?? []) as PriceAlert[];
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === "ResourceNotFoundException") return [];
    throw err;
  }
}

export async function createPriceAlert(
  data: Omit<PriceAlert, "alertId" | "createdAt">
): Promise<PriceAlert> {
  const alert: PriceAlert = {
    ...data,
    alertId: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  try {
    await docClient.send(
      new PutCommand({ TableName: priceAlertsTable, Item: alert })
    );
    return alert;
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === "ResourceNotFoundException") {
      throw new Error(`Table not found: ${priceAlertsTable}`);
    }
    throw err;
  }
}

export async function updatePriceAlert(
  userId: string,
  alertId: string,
  updates: Partial<PriceAlert>
): Promise<PriceAlert | undefined> {
  const entries = Object.entries(updates).filter(
    ([k]) => k !== "userId" && k !== "alertId"
  );
  if (entries.length === 0) {
    const result = await docClient.send(
      new GetCommand({ TableName: priceAlertsTable, Key: { userId, alertId } })
    );
    return result.Item as PriceAlert | undefined;
  }

  const setExpr = entries.map(([k], i) => `#f${i} = :v${i}`).join(", ");
  const names = Object.fromEntries(entries.map(([k], i) => [`#f${i}`, k]));
  const values = Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v]));

  try {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: priceAlertsTable,
        Key: { userId, alertId },
        UpdateExpression: `SET ${setExpr}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      })
    );
    return result.Attributes as PriceAlert | undefined;
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === "ResourceNotFoundException") {
      throw new Error(`Table not found: ${priceAlertsTable}`);
    }
    throw err;
  }
}

export async function deletePriceAlert(userId: string, alertId: string): Promise<void> {
  try {
    await docClient.send(
      new DeleteCommand({ TableName: priceAlertsTable, Key: { userId, alertId } })
    );
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === "ResourceNotFoundException") {
      throw new Error(`Table not found: ${priceAlertsTable}`);
    }
    throw err;
  }
}

// ── Rebooking History ─────────────────────────────────────────────────────────

export async function createRebookingHistory(
  data: Omit<RebookingHistory, "timestamp">
): Promise<RebookingHistory> {
  const record: RebookingHistory = {
    ...data,
    timestamp: new Date().toISOString(),
  };
  try {
    await docClient.send(
      new PutCommand({ TableName: rebookingHistoryTable, Item: record })
    );
    return record;
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === "ResourceNotFoundException") {
      throw new Error(`Table not found: ${rebookingHistoryTable}`);
    }
    throw err;
  }
}

export async function getRebookingHistoryByUserId(userId: string): Promise<RebookingHistory[]> {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: rebookingHistoryTable,
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": userId },
      })
    );
    return (result.Items ?? []) as RebookingHistory[];
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === "ResourceNotFoundException") return [];
    throw err;
  }
}

// ── Loyalty Transactions ──────────────────────────────────────────────────────

export async function createLoyaltyTransaction(
  data: Omit<LoyaltyTransaction, "transactionId" | "timestamp">
): Promise<LoyaltyTransaction> {
  const tx: LoyaltyTransaction = {
    ...data,
    transactionId: randomUUID(),
    timestamp: new Date().toISOString(),
  };
  try {
    await docClient.send(
      new PutCommand({ TableName: loyaltyTransactionsTable, Item: tx })
    );
    return tx;
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === "ResourceNotFoundException") {
      throw new Error(`Table not found: ${loyaltyTransactionsTable}`);
    }
    throw err;
  }
}

export async function getLoyaltyTransactionsByUserId(userId: string): Promise<LoyaltyTransaction[]> {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: loyaltyTransactionsTable,
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": userId },
      })
    );
    return (result.Items ?? []) as LoyaltyTransaction[];
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === "ResourceNotFoundException") return [];
    throw err;
  }
}

export async function updateUserLoyaltyPoints(userId: string, pointsDelta: number): Promise<number> {
  try {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: usersTable,
        Key: { id: userId },
        UpdateExpression:
          "SET loyaltyPoints = if_not_exists(loyaltyPoints, :zero) + :delta",
        ExpressionAttributeValues: { ":zero": 0, ":delta": pointsDelta },
        ReturnValues: "ALL_NEW",
      })
    );
    const newBalance = (result.Attributes?.loyaltyPoints as number) ?? 0;
    if (newBalance < 0) {
      // Clamp to 0
      await docClient.send(
        new UpdateCommand({
          TableName: usersTable,
          Key: { id: userId },
          UpdateExpression: "SET loyaltyPoints = :zero",
          ExpressionAttributeValues: { ":zero": 0 },
        })
      );
      return 0;
    }
    return newBalance;
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === "ResourceNotFoundException") {
      throw new Error(`Table not found: ${usersTable}`);
    }
    throw err;
  }
}

// ── Notification Log ──────────────────────────────────────────────────────────

export async function createNotificationLog(
  data: Omit<NotificationLog, "notificationId">
): Promise<NotificationLog> {
  const log: NotificationLog = {
    ...data,
    notificationId: randomUUID(),
  };
  try {
    await docClient.send(
      new PutCommand({ TableName: notificationLogTable, Item: log })
    );
    return log;
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === "ResourceNotFoundException") {
      throw new Error(`Table not found: ${notificationLogTable}`);
    }
    throw err;
  }
}

export async function getUnreadNotificationsByUserId(userId: string): Promise<NotificationLog[]> {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: notificationLogTable,
        KeyConditionExpression: "userId = :userId",
        FilterExpression: "#read = :false OR attribute_not_exists(#read)",
        ExpressionAttributeNames: { "#read": "read" },
        ExpressionAttributeValues: { ":userId": userId, ":false": false },
      })
    );
    return (result.Items ?? []) as NotificationLog[];
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === "ResourceNotFoundException") return [];
    throw err;
  }
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<void> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: notificationLogTable,
        Key: { userId, notificationId },
        UpdateExpression: "SET #read = :true",
        ExpressionAttributeNames: { "#read": "read" },
        ExpressionAttributeValues: { ":true": true },
      })
    );
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === "ResourceNotFoundException") {
      throw new Error(`Table not found: ${notificationLogTable}`);
    }
    throw err;
  }
}

// ── Google SSO upsert ─────────────────────────────────────────────────────────

export async function upsertUserFromGoogle(data: {
  name: string;
  email: string;
  googleId: string;
  pictureUrl: string;
}): Promise<{ user: User; isNew: boolean }> {
  const existing = await getUserByEmail(data.email);

  if (existing) {
    try {
      const result = await docClient.send(
        new UpdateCommand({
          TableName: usersTable,
          Key: { id: existing.id },
          UpdateExpression: "SET googleId = :googleId, pictureUrl = :pictureUrl",
          ExpressionAttributeValues: {
            ":googleId": data.googleId,
            ":pictureUrl": data.pictureUrl,
          },
          ReturnValues: "ALL_NEW",
        })
      );
      return { user: result.Attributes as User, isNew: false };
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "ResourceNotFoundException") {
        throw new Error(`Table not found: ${usersTable}`);
      }
      throw err;
    }
  }

  const user: User = {
    id: randomUUID(),
    name: data.name.trim(),
    email: data.email.trim().toLowerCase(),
    passwordHash: null,
    createdAt: new Date().toISOString(),
    googleId: data.googleId,
    pictureUrl: data.pictureUrl,
    loyaltyPoints: 0,
    notificationPreferences: { inApp: true, email: false },
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: usersTable,
        Item: user,
        ConditionExpression: "attribute_not_exists(id)",
      })
    );
    return { user, isNew: true };
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === "ResourceNotFoundException") {
      throw new Error(`Table not found: ${usersTable}`);
    }
    throw err;
  }
}
