import { auth } from "@/auth";
import { getUserById } from "@/lib/db";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createRequestLogger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-2" });
const docClient = DynamoDBDocumentClient.from(client);
const usersTable = process.env.DDB_USERS_TABLE || "airline-users";

export async function GET(request: NextRequest) {
  const session = await auth();
  const logger = createRequestLogger(
    request.headers.get("x-correlation-id") ?? undefined,
    session?.user?.id
  );

  if (!session?.user?.id) {
    logger.finish({ route: "/api/user/preferences", method: "GET", status: 401 });
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const user = await getUserById(session.user.id);
  logger.finish({ route: "/api/user/preferences", method: "GET", status: 200 });
  return NextResponse.json(
    user?.notificationPreferences ?? { inApp: true, email: false }
  );
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  const logger = createRequestLogger(
    request.headers.get("x-correlation-id") ?? undefined,
    session?.user?.id
  );

  if (!session?.user?.id) {
    logger.finish({ route: "/api/user/preferences", method: "PATCH", status: 401 });
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logger.finish({ route: "/api/user/preferences", method: "PATCH", status: 400 });
    return NextResponse.json({ message: "Invalid JSON body." }, { status: 400 });
  }

  const { notificationPreferences } = body as Record<string, unknown>;

  if (
    !notificationPreferences ||
    typeof notificationPreferences !== "object" ||
    Array.isArray(notificationPreferences)
  ) {
    logger.finish({ route: "/api/user/preferences", method: "PATCH", status: 400 });
    return NextResponse.json(
      { message: "notificationPreferences object is required." },
      { status: 400 }
    );
  }

  const prefs = notificationPreferences as Record<string, unknown>;

  if (
    ("inApp" in prefs && typeof prefs.inApp !== "boolean") ||
    ("email" in prefs && typeof prefs.email !== "boolean")
  ) {
    logger.finish({ route: "/api/user/preferences", method: "PATCH", status: 400 });
    return NextResponse.json(
      { message: "notificationPreferences.inApp and email must be booleans." },
      { status: 400 }
    );
  }

  // Fetch current preferences to merge with updates
  const user = await getUserById(session.user.id);
  const current = user?.notificationPreferences ?? { inApp: true, email: false };
  const updated = {
    inApp: "inApp" in prefs ? (prefs.inApp as boolean) : current.inApp,
    email: "email" in prefs ? (prefs.email as boolean) : current.email,
  };

  await docClient.send(
    new UpdateCommand({
      TableName: usersTable,
      Key: { id: session.user.id },
      UpdateExpression: "SET notificationPreferences = :prefs",
      ExpressionAttributeValues: { ":prefs": updated },
    })
  );

  logger.finish({ route: "/api/user/preferences", method: "PATCH", status: 200 });
  return NextResponse.json(updated);
}
