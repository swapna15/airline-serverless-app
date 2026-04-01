# Requirements Document

## Introduction

This feature enhances the existing airline booking application with real-time flight data, intelligent fare drop detection, proactive rebooking, ancillary bundling, and a multilingual AI travel concierge. The goal is to create end-to-end stickiness across the full travel lifecycle: intent → booking → servicing → loyalty → rebooking.

The system integrates with the existing Next.js frontend, DynamoDB-backed APIs, AWS Lambda functions, and Bedrock-powered AI chat widget to deliver a seamless, proactive travel experience.

## Glossary

- **Fare_Monitor**: The background service that polls real-time flight pricing data and detects fare drops against user bookings.
- **Rebooking_Engine**: The service that evaluates rebooking eligibility, executes seat transfers, and cancels original bookings.
- **Price_Alert**: A user-configured threshold that triggers a notification when a fare drops below a specified amount.
- **Disruption_Detector**: The service that monitors flight status feeds for delays, cancellations, and weather events.
- **Ancillary_Bundler**: The service that assembles and prices bundles of ancillary products (seat upgrades, baggage, lounge access, hotel, ground transport).
- **Concierge**: The Bedrock-powered AI chat assistant extended with multilingual support and travel servicing tools.
- **User**: An authenticated passenger with an active session.
- **Booking**: An existing confirmed reservation in the `airline-bookings` DynamoDB table.
- **Flight**: A scheduled flight record in the `airline-flights` DynamoDB table.
- **IATA_Code**: A 3-letter airport identifier (e.g., ORD, JFK).
- **Fare_Drop_Threshold**: A user-defined price (in USD) below which the Fare_Monitor triggers a Price_Alert.
- **Disruption_Event**: A flight status change indicating a delay of 60 minutes or more, a cancellation, or a weather advisory.
- **Bundle**: A packaged set of ancillary products offered at a combined price.
- **Loyalty_Points**: Reward points accrued by the User for bookings and ancillary purchases.
- **Auth_System**: The NextAuth.js-based authentication layer responsible for managing provider sign-in flows, session issuance, and user identity persistence.
- **Sabre_API**: The Sabre Dev Studio REST API (https://developer.sabre.com) used as the real-time flight pricing and status data source. Provides BargainFinderMax (flight search), Revalidate Itinerary (fare confirmation), and Flight Status endpoints. Authentication uses OAuth 2.0 client credentials with Basic auth encoding.

---

## Requirements

### Requirement 1: Real-Time Flight Pricing

**User Story:** As a User, I want to see live fare prices when searching for flights, so that I can make booking decisions based on current market rates.

#### Acceptance Criteria

1. WHEN a User submits a flight search with valid origin, destination, and date, THE System SHALL query the Sabre_API BargainFinderMax endpoint and return flight results with prices refreshed within the last 5 minutes.
2. WHEN a flight price changes between search and checkout, THE System SHALL confirm the current fare via the Sabre_API Revalidate Itinerary endpoint and display the updated price to the User before confirming the booking.
3. IF a real-time pricing source is unavailable, THEN THE System SHALL return the last cached price and display a staleness indicator showing the age of the data in minutes.
4. THE System SHALL cache real-time pricing data with a time-to-live of 5 minutes per route-date combination.
5. WHEN a User views a flight detail page, THE System SHALL display the current price alongside the price at the time of the User's last search for that route.

---

### Requirement 2: Fare Drop Detection and Price Alerts

**User Story:** As a User, I want to set a fare drop alert on a route, so that I am notified when prices fall below my target and can rebook at a lower fare.

#### Acceptance Criteria

1. WHEN a User creates a Price_Alert for a route with a Fare_Drop_Threshold, THE System SHALL store the alert associated with the User's account.
2. THE Fare_Monitor SHALL evaluate all active Price_Alerts against current pricing at intervals of no more than 15 minutes.
3. WHEN the Fare_Monitor detects a fare at or below a User's Fare_Drop_Threshold, THE System SHALL send the User a notification within 2 minutes of detection.
4. THE System SHALL support notification delivery via in-app notification and email.
5. WHEN a User has an existing Booking on a route and the fare drops by 10% or more below the booked price, THE Fare_Monitor SHALL automatically flag the Booking as eligible for rebooking.
6. IF a Price_Alert has not triggered within 30 days of creation, THEN THE System SHALL notify the User and offer to extend or delete the alert.
7. THE System SHALL allow a User to create, view, update, and delete Price_Alerts for any route.

---

### Requirement 3: Proactive Rebooking

**User Story:** As a User, I want the system to automatically rebook me onto a lower-fare flight when one becomes available, so that I save money without manual effort.

#### Acceptance Criteria

1. WHEN a Booking is flagged as eligible for rebooking and the User has enabled auto-rebook for that Booking, THE Rebooking_Engine SHALL identify the lowest available fare on an equivalent route within 2 hours of the original departure time.
2. WHEN the Rebooking_Engine identifies a suitable replacement flight, THE System SHALL cancel the original Booking and create a new Booking on the replacement flight within the same transaction.
3. IF the replacement flight has no available seats in the same cabin class as the original Booking, THEN THE Rebooking_Engine SHALL NOT proceed with automatic rebooking and SHALL notify the User of the fare drop instead.
4. WHEN a rebooking is completed, THE System SHALL send the User a confirmation notification containing the original flight details, the new flight details, and the fare difference saved.
5. THE System SHALL maintain a rebooking history per User, recording the original booking, replacement booking, fare saved, and timestamp.
6. WHEN a User disables auto-rebook for a Booking, THE Rebooking_Engine SHALL cease monitoring that Booking for fare drops.
7. THE System SHALL allow a User to manually trigger rebooking for any Booking flagged as eligible.

---

### Requirement 4: Proactive Disruption Rebooking

**User Story:** As a User, I want the system to proactively offer me alternative flights when my flight is delayed or cancelled, so that I can continue my journey with minimal disruption.

#### Acceptance Criteria

1. THE Disruption_Detector SHALL poll the Sabre_API Flight Status endpoint at intervals of no more than 5 minutes for all flights with active Bookings departing within the next 24 hours.
2. WHEN the Disruption_Detector identifies a Disruption_Event on a flight with active Bookings, THE System SHALL notify all affected Users within 5 minutes of detection.
3. WHEN a Disruption_Event is detected, THE System SHALL present each affected User with up to 3 alternative flight options on the same route departing within 6 hours of the original departure time.
4. WHEN a User selects an alternative flight following a Disruption_Event, THE Rebooking_Engine SHALL transfer the Booking to the selected flight and cancel the original Booking.
5. IF no alternative flights are available within 6 hours of the original departure, THEN THE System SHALL present the User with options to rebook on the next available flight or request a full refund.
6. WHEN a disruption rebooking is completed, THE System SHALL send the User a confirmation notification with the new itinerary details.
7. THE System SHALL log all Disruption_Events and associated rebooking actions for audit purposes.

---

### Requirement 5: Ancillary Bundling

**User Story:** As a User, I want to add seat upgrades, baggage, lounge access, hotel, and ground transport to my booking in a single step, so that I can manage my full trip in one place.

#### Acceptance Criteria

1. WHEN a User completes a flight booking, THE Ancillary_Bundler SHALL present available ancillary options including seat upgrades, checked baggage, lounge access, hotel, and ground transport for the destination.
2. THE Ancillary_Bundler SHALL calculate and display a combined Bundle price that is less than or equal to the sum of individual ancillary prices.
3. WHEN a User selects a Bundle, THE System SHALL add all Bundle components to the Booking and charge the Bundle price in a single transaction.
4. IF a Bundle component becomes unavailable after the User initiates checkout, THEN THE System SHALL notify the User, remove the unavailable component, and recalculate the Bundle price before confirming the transaction.
5. THE System SHALL allow a User to add individual ancillary items to an existing Booking up to 24 hours before departure.
6. WHEN a Booking is cancelled, THE System SHALL refund all ancillary charges associated with that Booking.
7. THE Ancillary_Bundler SHALL surface hotel and ground transport options sourced from third-party providers via configurable API integrations.

---

### Requirement 6: Multilingual AI Travel Concierge

**User Story:** As a User, I want to interact with the AI travel assistant in my preferred language, so that I can get help with bookings and travel queries without a language barrier.

#### Acceptance Criteria

1. THE Concierge SHALL detect the language of the User's input message and respond in the same language.
2. THE Concierge SHALL support a minimum of 10 languages including English, Spanish, French, German, Japanese, Portuguese, Arabic, Hindi, Mandarin Chinese, and Italian.
3. WHEN a User asks the Concierge to search for flights, check a booking, or initiate a rebooking, THE Concierge SHALL invoke the appropriate tool and return the result in the User's detected language.
4. WHEN a User asks the Concierge about fare drop alerts, THE Concierge SHALL allow the User to create, view, and delete Price_Alerts through the chat interface.
5. WHEN a User asks the Concierge about ancillary options for an existing Booking, THE Concierge SHALL present available Bundle options and allow the User to add them through the chat interface.
6. IF the Concierge cannot fulfill a User request due to a tool error, THEN THE Concierge SHALL respond with a descriptive error message in the User's detected language and suggest an alternative action.
7. THE Concierge SHALL maintain conversation context across a minimum of 20 message turns within a single session.

---

### Requirement 7: Loyalty Points Accrual

**User Story:** As a User, I want to earn loyalty points for bookings and ancillary purchases, so that I am rewarded for my travel activity and incentivized to rebook.

#### Acceptance Criteria

1. WHEN a Booking is confirmed, THE System SHALL credit the User's account with Loyalty_Points equal to 10 points per USD of the base fare.
2. WHEN a User purchases an ancillary item or Bundle, THE System SHALL credit the User's account with Loyalty_Points equal to 5 points per USD of the ancillary purchase price.
3. WHEN a rebooking results in a fare saving, THE System SHALL credit the User's account with Loyalty_Points equal to 5 points per USD saved.
4. WHEN a Booking is cancelled, THE System SHALL deduct the Loyalty_Points previously credited for that Booking from the User's account.
5. THE System SHALL display the User's current Loyalty_Points balance and a transaction history on the User's account page.
6. IF a Loyalty_Points deduction would result in a negative balance, THEN THE System SHALL set the balance to zero and log the discrepancy.

---

### Requirement 8: Fare Price Data Parsing and Serialization

**User Story:** As a developer, I want fare price data to be reliably parsed and serialized, so that pricing information is consistent across all system components.

#### Acceptance Criteria

1. WHEN a real-time pricing response is received from an external source, THE System SHALL parse it into a structured Fare object containing route, departure date, cabin class, price in USD, currency, and data timestamp.
2. IF a pricing response is malformed or missing required fields, THEN THE System SHALL log the error with the raw response payload and return a descriptive parse error.
3. THE System SHALL serialize Fare objects to JSON for storage in DynamoDB and for transmission to the frontend.
4. FOR ALL valid Fare objects, parsing then serializing then parsing SHALL produce an equivalent Fare object (round-trip property).
5. THE System SHALL validate that parsed fare prices are positive numbers with no more than 2 decimal places.

---

### Requirement 9: Google SSO Authentication

**User Story:** As a User, I want to sign in with my Google account, so that I can access the application without managing a separate password.

#### Acceptance Criteria

1. WHEN a User initiates Google SSO login, THE Auth_System SHALL redirect the User to the Google OAuth 2.0 authorization endpoint using the NextAuth Google provider.
2. WHEN Google returns a successful OAuth callback, THE Auth_System SHALL extract the User's name, email, profile picture URL, and Google account ID from the ID token claims.
3. WHEN a Google SSO callback is received for an email address that does not exist in the users table, THE Auth_System SHALL create a new User record containing the name, email, profile picture URL, Google ID, and a null passwordHash, then establish an authenticated session.
4. WHEN a Google SSO callback is received for an email address that already exists in the users table, THE Auth_System SHALL link the Google ID and profile picture URL to the existing User record and establish an authenticated session without creating a duplicate record.
5. WHEN a User record is created or updated via Google SSO, THE Auth_System SHALL store the googleId, pictureUrl, name, and email fields in the airline-users DynamoDB table.
6. WHEN an authenticated SSO session is established, THE Auth_System SHALL issue a JWT containing the User's id, name, email, and pictureUrl, consistent with the existing session strategy.
7. IF the Google OAuth callback contains an error or is missing required claims (name, email, or Google ID), THEN THE Auth_System SHALL reject the authentication attempt and redirect the User to the login page with a descriptive error message.
8. WHEN a User with a Google SSO account attempts to sign in using the credentials provider with the same email, THE Auth_System SHALL allow the sign-in only if a passwordHash is present on the User record.

---

### Requirement 10: Sabre API Integration

**User Story:** As a developer, I want the system to integrate with the Sabre Dev Studio API in a reliable and configurable way, so that real-time flight data is available across all features without service disruption.

#### Acceptance Criteria

1. WHEN the System initializes a Sabre_API client, THE System SHALL authenticate using the OAuth 2.0 client credentials flow by sending a Basic auth header (base64-encoded `clientId:clientSecret`) to the Sabre token endpoint at `{SABRE_BASE_URL}/v2/auth/token`.
2. WHEN a Sabre_API bearer token is within 60 seconds of expiry, THE System SHALL proactively request a new token before the next API call is made.
3. WHEN the Sabre_API returns an HTTP 429 response, THE System SHALL apply exponential backoff with a maximum of 3 retries before returning an error to the caller.
4. WHEN the Sabre_API quota for the current billing period is exhausted, THE System SHALL log a quota-exceeded error, cease further Sabre_API calls for the remainder of the period, and fall back to cached data where available.
5. THE System SHALL support switching between the Sabre certification environment (`https://api.cert.platform.sabre.com`) and the Sabre production environment (`https://api.platform.sabre.com`) via a single `SABRE_ENV` environment variable without code changes.
6. WHEN the Sabre_API returns an error response (4xx or 5xx), THE System SHALL log the HTTP status code, the Sabre error code, and the request correlation ID, then return a structured error to the caller.
7. IF the Sabre_API is unreachable due to a network failure, THEN THE System SHALL treat the failure identically to a 5xx response and apply the same retry and fallback behaviour.

---

### Requirement 11: User Notification Preferences

**User Story:** As a User, I want to control which notification channels I receive alerts on, so that I only get notified in ways that suit me.

#### Acceptance Criteria

1. THE System SHALL store a `notificationPreferences` object on the User record containing per-channel opt-in flags for `inApp` and `email`.
2. WHEN a new User record is created, THE System SHALL default `notificationPreferences` to `{ inApp: true, email: false }`.
3. WHEN a User updates their notification preferences, THE System SHALL persist the updated preferences to the `airline-users` DynamoDB table.
4. WHEN the System sends a notification and the User's `notificationPreferences.email` is `true`, THE System SHALL deliver the notification via Amazon SES.
5. WHEN the System sends a notification and the User's `notificationPreferences.inApp` is `true`, THE System SHALL deliver the notification via the in-app notification channel.
6. IF a User has both `inApp` and `email` set to `false`, THEN THE System SHALL skip notification delivery and log the suppression against the User's record.
7. WHERE a User record does not contain a `notificationPreferences` field, THE System SHALL treat the record as having the default preferences `{ inApp: true, email: false }` without modifying the stored record.

---

### Requirement 12: Booking Cancellation and Refunds

**User Story:** As a User, I want to cancel a booking and receive a refund, so that I am not charged for travel I will not take.

#### Acceptance Criteria

1. WHEN a User cancels a Booking 24 or more hours before the scheduled departure time, THE System SHALL issue a full refund of the base fare and all associated ancillary charges.
2. WHEN a User cancels a Booking less than 24 hours before the scheduled departure time, THE System SHALL issue a partial refund calculated according to the configured late-cancellation policy.
3. WHEN a refund is issued, THE System SHALL process ancillary refunds in the same transaction as the base fare refund.
4. WHEN a refund is processed, THE System SHALL record the refund amount, timestamp, and refund reference on the Booking record.
5. WHEN a refund is processed, THE System SHALL send the User a refund confirmation notification containing the refund amount and expected settlement timeframe.
6. IF a refund transaction fails, THEN THE System SHALL log the failure with the Booking ID and refund amount, and retry the refund up to 3 times before marking the Booking as requiring manual review.

---

### Requirement 13: Auto-Rebook User Preference Management

**User Story:** As a User, I want to manage my auto-rebook preference per booking, so that I have control over when the system acts on my behalf.

#### Acceptance Criteria

1. THE System SHALL store an `autoRebook` boolean flag on each Booking record, defaulting to `false` for all new Bookings.
2. WHEN a User toggles the `autoRebook` preference for a Booking from the booking detail page or the my-bookings page, THE System SHALL persist the updated value to the `airline-bookings` DynamoDB table.
3. WHILE a Booking has `autoRebook` set to `false`, THE Rebooking_Engine SHALL NOT automatically rebook that Booking.
4. WHEN the Rebooking_Engine triggers an automatic rebooking for a Booking, THE System SHALL send the User a notification identifying the original Booking, the replacement flight, and the fare saved.
5. THE System SHALL display the current `autoRebook` state for each Booking on both the booking detail page and the my-bookings page.

---

### Requirement 14: API Rate Limiting

**User Story:** As a system operator, I want the application's own API routes to be protected against abuse, so that background services and user-facing endpoints remain available under load.

#### Acceptance Criteria

1. THE System SHALL enforce rate limiting on all Next.js API routes, including `/api/flights`, `/api/bookings`, and `/api/chat`.
2. THE System SHALL apply per-user rate limits for authenticated requests and per-IP rate limits for unauthenticated requests.
3. WHEN a request exceeds the configured rate limit, THE System SHALL return an HTTP 429 response containing a `Retry-After` header specifying the number of seconds until the limit resets.
4. THE System SHALL read rate limit thresholds from environment variables, allowing limits to be adjusted without code changes.
5. IF an environment variable for a rate limit threshold is absent, THEN THE System SHALL apply a default limit of 60 requests per minute per user or IP.

---

### Requirement 15: User Schema Migration

**User Story:** As a developer, I want the User data model to include all fields required by new features, so that authentication, loyalty, and profile features work correctly.

#### Acceptance Criteria

1. THE System SHALL define the User type to include the optional fields `googleId` (string), `pictureUrl` (string), `loyaltyPoints` (number), and `notificationPreferences` (object).
2. WHEN a new User record is created, THE System SHALL set `loyaltyPoints` to `0` and `notificationPreferences` to `{ inApp: true, email: false }`.
3. WHERE a User record in the `airline-users` DynamoDB table does not contain `loyaltyPoints`, THE System SHALL treat the value as `0` without requiring a write to the stored record.
4. WHERE a User record in the `airline-users` DynamoDB table does not contain `notificationPreferences`, THE System SHALL treat the value as `{ inApp: true, email: false }` without requiring a write to the stored record.
5. THE System SHALL NOT perform a destructive migration that removes or overwrites existing User record fields.

---

### Requirement 16: DynamoDB Table Definitions for New Features

**User Story:** As a developer, I want all new DynamoDB tables to have clearly defined key schemas and indexes, so that the infrastructure can be provisioned correctly.

#### Acceptance Criteria

1. THE System SHALL provision an `airline-price-alerts` table with partition key `userId` (string) and sort key `alertId` (string), and a GSI on `routeKey` to support Fare_Monitor polling across all alerts for a given route.
2. THE System SHALL provision an `airline-rebooking-history` table with partition key `userId` (string) and sort key `timestamp` (string), with attributes `originalBookingId`, `newBookingId`, and `fareSaved`.
3. THE System SHALL provision an `airline-loyalty-transactions` table with partition key `userId` (string) and sort key `transactionId` (string), with attributes `type`, `points`, `referenceId`, and `timestamp`.
4. THE System SHALL provision an `airline-notification-log` table with partition key `userId` (string) and sort key `notificationId` (string), with attributes `channel`, `message`, `sentAt`, and `status`.
5. WHEN a read operation targets a new table and the table does not yet exist, THE System SHALL return a descriptive error identifying the missing table rather than propagating an unhandled exception.

---

### Requirement 17: Background Job Scheduling

**User Story:** As a system operator, I want the Fare_Monitor and Disruption_Detector to run on a reliable schedule, so that fare drops and disruptions are detected without manual intervention.

#### Acceptance Criteria

1. THE System SHALL define an AWS EventBridge Scheduler rule that invokes a dedicated Lambda function for the Fare_Monitor on a schedule of every 15 minutes.
2. THE System SHALL define an AWS EventBridge Scheduler rule that invokes a dedicated Lambda function for the Disruption_Detector on a schedule of every 5 minutes.
3. THE System SHALL define both EventBridge Scheduler rules and their associated Lambda functions in Terraform.
4. THE Fare_Monitor Lambda function and the Disruption_Detector Lambda function SHALL be deployed independently of the Next.js application.
5. THE System SHALL attach a dead-letter queue (SQS) to each scheduled Lambda function to capture failed invocations.
6. WHEN the dead-letter queue for either Lambda function receives one or more messages, THE System SHALL trigger a CloudWatch alarm notifying the configured SNS topic.

---

### Requirement 18: Observability and Monitoring

**User Story:** As a system operator, I want structured logs, metrics, and alerts for all background services, so that I can detect and respond to failures quickly.

#### Acceptance Criteria

1. THE System SHALL emit structured JSON log entries for all Lambda function invocations and all Next.js API route handlers, including the fields `correlationId`, `userId` (where available), and `duration`.
2. THE System SHALL publish CloudWatch metrics for Fare_Monitor poll success rate, Fare_Monitor poll failure rate, Disruption_Detector poll success rate, Disruption_Detector poll failure rate, rebooking success rate, rebooking failure rate, and Sabre_API error rate.
3. WHEN the error rate for any monitored metric exceeds 5% over a 5-minute evaluation window, THE System SHALL trigger a CloudWatch alarm that publishes a notification to the configured SNS topic.
4. THE System SHALL provide a CloudWatch dashboard displaying all key metrics defined in acceptance criterion 2.
5. IF a Lambda function invocation produces no log output, THEN THE System SHALL treat the invocation as a failure and increment the corresponding failure metric.
