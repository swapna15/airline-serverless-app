import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { randomUUID } from "crypto";

const region = process.env.AWS_REGION || "us-east-2";
const usersTable = process.env.DDB_USERS_TABLE || "airline-users";
const notificationLogTable = process.env.DDB_NOTIFICATION_LOG_TABLE || "airline-notification-log";
const sesFromEmail = process.env.SES_FROM_EMAIL || "noreply@airline.example.com";

const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);
const sesClient = new SESClient({ region });

const SUBJECT_MAP = {
  fare_drop: "Fare Drop Alert",
  rebooking_confirmed: "Rebooking Confirmed",
  disruption: "Flight Disruption Notice",
  refund: "Refund Processed",
  alert_expiry: "Price Alert Expired",
};

export const handler = async (event) => {
  const correlationId = event.correlationId || randomUUID();
  const startTime = Date.now();
  const { userId, type, message, metadata } = event;

  try {
    // Load user from DynamoDB
    const userResult = await docClient.send(
      new GetCommand({ TableName: usersTable, Key: { id: userId } })
    );
    const user = userResult.Item;

    // Default notification preferences if absent
    const prefs = user?.notificationPreferences ?? { inApp: true, email: false };

    if (!prefs.inApp && !prefs.email) {
      console.log(JSON.stringify({ correlationId, userId, type, message: "Notification suppressed — all channels disabled" }));
    } else {
      // In-app notification
      if (prefs.inApp) {
        await docClient.send(
          new PutCommand({
            TableName: notificationLogTable,
            Item: {
              userId,
              notificationId: randomUUID(),
              channel: "inApp",
              message,
              sentAt: new Date().toISOString(),
              status: "sent",
              read: false,
            },
          })
        );
      }

      // Email notification
      if (prefs.email) {
        const subject = SUBJECT_MAP[type] || "Airline Notification";
        try {
          await sesClient.send(
            new SendEmailCommand({
              Source: sesFromEmail,
              Destination: { ToAddresses: [user.email] },
              Message: {
                Subject: { Data: subject },
                Body: { Text: { Data: message } },
              },
            })
          );
        } catch (sesErr) {
          console.error(JSON.stringify({ correlationId, userId, type, error: sesErr.message, detail: "SES send failed" }));
          await docClient.send(
            new PutCommand({
              TableName: notificationLogTable,
              Item: {
                userId,
                notificationId: randomUUID(),
                channel: "email",
                message,
                sentAt: new Date().toISOString(),
                status: "failed",
                read: false,
              },
            })
          );
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(JSON.stringify({ correlationId, userId, type, duration, status: "success" }));
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(JSON.stringify({ correlationId, userId, error: err.message, duration }));
    throw err;
  }
};
