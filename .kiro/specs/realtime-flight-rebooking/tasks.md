# Implementation Plan: Real-Time Flight Rebooking

## Overview

Implement the real-time flight rebooking feature incrementally, starting with the shared foundation (types, Amadeus client, fare parser), then building each Lambda service, then the Next.js API routes and auth extensions, and finally the Terraform infrastructure. Property-based tests with fast-check are placed immediately after the code they validate.

## Tasks

- [x] 1. Extend shared types and install dependencies
  - Add `fast-check` dev dependency: `npm install --save-dev fast-check`
  - Extend `lib/types.ts` with the new optional fields on `User` and `Booking` as specified in the design (`googleId`, `pictureUrl`, `loyaltyPoints`, `notificationPreferences`, `autoRebook`, `ancillaries`, `refund`)
  - Add new types to `lib/types.ts`: `PriceAlert`, `RebookingHistory`, `LoyaltyTransaction`, `NotificationLog`, `AncillaryItem`
  - _Requirements: 7.1, 9.5, 11.1, 13.1, 15.1, 15.2, 16.2, 16.3, 16.4_

- [x] 2. Implement Amadeus API client (`lib/amadeus.ts`)
  - [x] 2.1 Implement `AmadeusClient` singleton with OAuth 2.0 client credentials flow, `getToken()` with proactive refresh when expiry < 60s, and environment switching via `AMADEUS_ENV`
    - Read `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET`, `AMADEUS_ENV` from environment
    - Base URL: `https://test.api.amadeus.com` (test) or `https://api.amadeus.com` (production)
    - _Requirements: 10.1, 10.2, 10.5_
  - [x] 2.2 Implement `searchFlightOffers`, `priceFlightOffer`, and `getFlightStatus` methods with exponential backoff retry (max 3) on HTTP 429 and 5xx, structured error logging with `correlationId`
    - _Requirements: 10.3, 10.4, 10.6, 10.7_
  - [ ]* 2.3 Write property test for Amadeus token proactive refresh
    - **Property 27: Amadeus token proactive refresh**
    - **Validates: Requirements 10.2**
  - [ ]* 2.4 Write property test for Amadeus retry with exponential backoff
    - **Property 28: Amadeus retry with exponential backoff**
    - **Validates: Requirements 10.3**
  - [ ]* 2.5 Write property test for Amadeus environment switching
    - **Property 29: Amadeus environment switching**
    - **Validates: Requirements 10.5**

- [x] 3. Implement fare parser (`lib/fare-parser.ts`)
  - [x] 3.1 Implement `parseFare(raw: unknown): Result<Fare, ParseError>`, `serializeFare(fare: Fare): string`, and `deserializeFare(json: string): Result<Fare, ParseError>`
    - Validate all required fields; reject malformed input with descriptive `ParseError`
    - Validate `priceUsd > 0` and `Math.round(priceUsd * 100) === priceUsd * 100`
    - _Requirements: 8.1, 8.2, 8.3, 8.5_
  - [ ]* 3.2 Write property test for fare round-trip serialization
    - **Property 22: Fare round-trip serialization**
    - **Validates: Requirements 8.3, 8.4**
  - [ ]* 3.3 Write property test for fare price validation
    - **Property 23: Fare price validation**
    - **Validates: Requirements 8.5**

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement ancillary bundler (`lib/ancillary.ts`)
  - [x] 5.1 Implement `buildBundle(items: AncillaryOption[]): Bundle` ensuring `bundlePrice <= individualTotal`, and `addAncillaryToBooking(bookingId, item, departureTime)` with 24h time gate
    - Return a descriptive error if departure is ≤ 24 hours away
    - _Requirements: 5.1, 5.2, 5.5_
  - [ ]* 5.2 Write property test for bundle price invariant
    - **Property 12: Bundle price invariant**
    - **Validates: Requirements 5.2**
  - [ ]* 5.3 Write property test for ancillary time gate
    - **Property 14: Ancillary time gate**
    - **Validates: Requirements 5.5**

- [x] 6. Extend `lib/db.ts` with new table accessors
  - Add DynamoDB accessors for `airline-price-alerts`, `airline-rebooking-history`, `airline-loyalty-transactions`, and `airline-notification-log` tables
  - Wrap all new table reads in `ResourceNotFoundException` handling that returns a structured error identifying the missing table name
  - Add `upsertUser` function for Google SSO (create-or-link by email)
  - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_
  - [ ]* 6.1 Write property test for missing DynamoDB table error handling
    - **Property 39: Missing DynamoDB table error handling**
    - **Validates: Requirements 16.5**

- [x] 7. Implement rate limiting middleware (`middleware.ts`)
  - [x] 7.1 Implement sliding-window rate limiter using a module-level `Map`, keyed by `userId` (authenticated) or IP (unauthenticated), reading threshold from env var with 60 rpm default; return HTTP 429 with `Retry-After` header on exceed
    - Apply to all `/api/*` routes
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_
  - [ ]* 7.2 Write property test for rate limit 429 with Retry-After
    - **Property 36: Rate limit 429 with Retry-After**
    - **Validates: Requirements 14.1, 14.2, 14.3**
  - [ ]* 7.3 Write property test for rate limit default threshold
    - **Property 37: Rate limit default threshold**
    - **Validates: Requirements 14.4, 14.5**

- [x] 8. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Extend `auth.ts` with Google SSO provider
  - [x] 9.1 Add `Google` provider to the NextAuth config alongside the existing `Credentials` provider; implement `signIn` callback to upsert user via `db.upsertUser` (create new record with null `passwordHash` for new emails, link `googleId`/`pictureUrl` for existing emails)
    - Read `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from environment
    - Reject callback if name, email, or Google ID is missing; redirect to `/login` with error
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_
  - [x] 9.2 Update `jwt` and `session` callbacks to include `pictureUrl` in the token and session
    - _Requirements: 9.6_
  - [x] 9.3 Guard credentials `authorize` to return `null` when the user record has a `googleId` but a null `passwordHash`
    - _Requirements: 9.8_
  - [ ]* 9.4 Write property test for Google SSO new user creation
    - **Property 24: Google SSO new user creation**
    - **Validates: Requirements 9.2, 9.3, 9.5**
  - [ ]* 9.5 Write property test for Google SSO no duplicate users
    - **Property 25: Google SSO no duplicate users**
    - **Validates: Requirements 9.4**
  - [ ]* 9.6 Write property test for credentials sign-in guard for SSO accounts
    - **Property 26: Credentials sign-in guard for SSO accounts**
    - **Validates: Requirements 9.8**

- [x] 10. Implement notification worker Lambda (`lambdas/notification-worker/index.js`)
  - [x] 10.1 Implement handler that accepts `NotificationPayload`, loads user preferences from `airline-users`, routes to in-app (write to `airline-notification-log`) and/or email (SES `SendEmail`) based on `notificationPreferences`, logs suppression when both channels are disabled
    - Default to `{ inApp: true, email: false }` when `notificationPreferences` is absent
    - Emit structured JSON log with `correlationId` and `duration`
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 18.1_
  - [ ]* 10.2 Write property test for notification channel routing
    - **Property 30: Notification channel routing**
    - **Validates: Requirements 11.4, 11.5**
  - [ ]* 10.3 Write property test for notification preferences default
    - **Property 31: Notification preferences default**
    - **Validates: Requirements 11.7, 15.4**

- [x] 11. Implement rebooking engine Lambda (`lambdas/rebooking-engine/index.js`)
  - [x] 11.1 Implement `rebook(bookingId, replacementFlightId)`: load original booking and replacement flight, verify available seats in same cabin class, execute DynamoDB `TransactWriteCommand` (cancel original, release seats, create new booking, reserve new seats, decrement `availableSeats`), write `RebookingHistory` record
    - _Requirements: 3.1, 3.2, 3.3, 4.4_
  - [x] 11.2 After successful rebook: calculate `fareSaved`, credit loyalty points (`floor(fareSaved * 5)`), write `LoyaltyTransaction`, invoke notification-worker with rebooking confirmation payload
    - _Requirements: 3.4, 3.5, 7.3_
  - [x] 11.3 Implement refund logic: full refund if departure ≥ 24h, partial refund otherwise; include all ancillary charges; retry up to 3 times on failure; mark `manualReview: true` after 3 failures; write `refund` object to booking record
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.6_
  - [ ]* 11.4 Write property test for rebooking atomicity
    - **Property 6: Rebooking atomicity**
    - **Validates: Requirements 3.2, 4.4**
  - [ ]* 11.5 Write property test for rebooking notification content
    - **Property 7: Rebooking notification content**
    - **Validates: Requirements 3.4, 4.6**
  - [ ]* 11.6 Write property test for rebooking history persistence
    - **Property 8: Rebooking history persistence**
    - **Validates: Requirements 3.5**
  - [ ]* 11.7 Write property test for auto-rebook guard
    - **Property 9: Auto-rebook guard**
    - **Validates: Requirements 3.6, 13.3**
  - [ ]* 11.8 Write property test for refund policy by cancellation timing
    - **Property 32: Refund policy by cancellation timing**
    - **Validates: Requirements 12.1, 12.2**
  - [ ]* 11.9 Write property test for refund record persistence
    - **Property 33: Refund record persistence**
    - **Validates: Requirements 12.4**
  - [ ]* 11.10 Write property test for refund retry on failure
    - **Property 34: Refund retry on failure**
    - **Validates: Requirements 12.6**
  - [ ]* 11.11 Write property test for loyalty points accrual — rebooking saving
    - **Property 20: Loyalty points accrual — rebooking saving**
    - **Validates: Requirements 7.3**

- [x] 12. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Implement fare monitor Lambda (`lambdas/fare-monitor/index.js`)
  - [x] 13.1 Implement handler: fetch all active `PriceAlert` records, group by `routeKey`, call `amadeusClient.searchFlightOffers()` per unique route, cache results in `airline-flights` with TTL metadata, evaluate each alert against current price
    - _Requirements: 1.1, 1.4, 2.2_
  - [x] 13.2 For alerts at or below threshold: invoke notification-worker with `fare_drop` payload; for bookings with `autoRebook=true` where current price ≤ `bookedPrice * 0.9`: flag booking and invoke rebooking-engine
    - _Requirements: 2.3, 2.5, 3.1_
  - [x] 13.3 Emit CloudWatch metrics: `pollSuccess`, `pollFailure`, `alertsEvaluated`, `rebookingsTriggered`; emit structured JSON log with `correlationId` and `duration`
    - _Requirements: 18.1, 18.2_
  - [ ]* 13.4 Write property test for fare cache freshness
    - **Property 1: Fare cache freshness**
    - **Validates: Requirements 1.1, 1.4**
  - [ ]* 13.5 Write property test for fare drop notification trigger
    - **Property 4: Fare drop notification trigger**
    - **Validates: Requirements 2.3, 2.4**
  - [ ]* 13.6 Write property test for auto-rebook eligibility flagging
    - **Property 5: Auto-rebook eligibility flagging**
    - **Validates: Requirements 2.5, 3.1**

- [x] 14. Implement disruption detector Lambda (`lambdas/disruption-detector/index.js`)
  - [x] 14.1 Implement handler: query `airline-bookings` for confirmed bookings departing within 24h, deduplicate by `flightId`, call `amadeusClient.getFlightStatus()` per flight, detect `Disruption_Event` (delay ≥ 60 min, cancellation, weather advisory)
    - _Requirements: 4.1, 4.2_
  - [x] 14.2 On disruption: find up to 3 alternative flights on same route within 6h window, invoke notification-worker for each affected booking, write `DisruptionEvent` record to `airline-notification-log`
    - _Requirements: 4.3, 4.5, 4.7_
  - [x] 14.3 Emit CloudWatch metrics and structured JSON logs with `correlationId` and `duration`
    - _Requirements: 18.1, 18.2_
  - [ ]* 14.4 Write property test for disruption alternatives constraint
    - **Property 10: Disruption alternatives constraint**
    - **Validates: Requirements 4.3**
  - [ ]* 14.5 Write property test for disruption event audit log
    - **Property 11: Disruption event audit log**
    - **Validates: Requirements 4.7**

- [x] 15. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Implement Next.js API routes — price alerts and real-time pricing
  - [x] 16.1 Create `app/api/price-alerts/route.ts` (GET list, POST create) and `app/api/price-alerts/[alertId]/route.ts` (PUT update, DELETE delete); validate input, persist to `airline-price-alerts` via `lib/db.ts`
    - _Requirements: 2.1, 2.7_
  - [x] 16.2 Create `app/api/flights/[flightId]/price/route.ts` (GET): call `amadeusClient.priceFlightOffer()`, return confirmed price; display staleness indicator if Amadeus is unavailable and cached data is returned
    - _Requirements: 1.2, 1.3, 1.5_
  - [ ]* 16.3 Write property test for price confirmation before booking
    - **Property 2: Price confirmation before booking**
    - **Validates: Requirements 1.2**
  - [ ]* 16.4 Write property test for price alert round-trip
    - **Property 3: Price alert round-trip**
    - **Validates: Requirements 2.1, 2.7**

- [x] 17. Implement Next.js API routes — rebooking and auto-rebook
  - [x] 17.1 Create `app/api/bookings/[bookingId]/rebook/route.ts` (POST): authenticate session, invoke rebooking-engine Lambda, return result
    - _Requirements: 3.7_
  - [x] 17.2 Create `app/api/bookings/[bookingId]/auto-rebook/route.ts` (PATCH): authenticate session, update `autoRebook` flag on booking in `airline-bookings`
    - Default `autoRebook` to `false` on new bookings (update `createBooking` in `lib/db.ts`)
    - _Requirements: 13.1, 13.2, 13.3_
  - [ ]* 17.3 Write property test for auto-rebook default
    - **Property 35: Auto-rebook default**
    - **Validates: Requirements 13.1**

- [x] 18. Implement Next.js API routes — ancillaries
  - [x] 18.1 Create `app/api/bookings/[bookingId]/ancillaries/route.ts` (GET list, POST add): authenticate session, call `lib/ancillary.ts` for time gate and bundle logic, persist to booking record, credit loyalty points (`floor(price * 5)`), write `LoyaltyTransaction`
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 7.2_
  - [ ]* 18.2 Write property test for bundle purchase atomicity
    - **Property 13: Bundle purchase atomicity**
    - **Validates: Requirements 5.3**
  - [ ]* 18.3 Write property test for ancillary refund on cancellation
    - **Property 15: Ancillary refund on cancellation**
    - **Validates: Requirements 5.6, 12.3**
  - [ ]* 18.4 Write property test for loyalty points accrual — ancillary
    - **Property 19: Loyalty points accrual — ancillary**
    - **Validates: Requirements 7.2**

- [x] 19. Implement Next.js API routes — notifications, loyalty, and preferences
  - [x] 19.1 Create `app/api/notifications/route.ts` (GET): authenticate session, query `airline-notification-log` for user's unread in-app notifications
    - _Requirements: 11.5_
  - [x] 19.2 Create `app/api/notifications/[id]/read/route.ts` (PATCH): authenticate session, mark notification as `read: true` in `airline-notification-log`
    - _Requirements: 11.5_
  - [x] 19.3 Create `app/api/user/loyalty/route.ts` (GET): authenticate session, return `loyaltyPoints` balance and `LoyaltyTransaction` history from `airline-loyalty-transactions`
    - Default `loyaltyPoints` to `0` when field is absent on user record
    - _Requirements: 7.5, 15.3_
  - [x] 19.4 Create `app/api/user/preferences/route.ts` (GET, PATCH): authenticate session, read/update `notificationPreferences` on user record in `airline-users`
    - _Requirements: 11.1, 11.2, 11.3_
  - [ ]* 19.5 Write property test for loyalty points accrual — booking
    - **Property 18: Loyalty points accrual — booking**
    - **Validates: Requirements 7.1**
  - [ ]* 19.6 Write property test for loyalty points deduction on cancellation
    - **Property 21: Loyalty points deduction on cancellation**
    - **Validates: Requirements 7.4, 7.6**
  - [ ]* 19.7 Write property test for user loyalty points default
    - **Property 38: User loyalty points default**
    - **Validates: Requirements 15.3**

- [x] 20. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 21. Add structured logging to all Lambda handlers and API routes
  - [x] 21.1 Create `lib/logger.ts` with a `log(fields: Record<string, unknown>)` helper that emits a JSON object including `correlationId` (from request header or `randomUUID()`), `duration`, and any caller-supplied fields
    - _Requirements: 18.1_
  - [x] 21.2 Instrument all four new Lambda handlers (`fare-monitor`, `disruption-detector`, `rebooking-engine`, `notification-worker`) and all 10 new Next.js API route handlers with `lib/logger.ts`
    - _Requirements: 18.1_
  - [ ]* 21.3 Write property test for structured log fields
    - **Property 40: Structured log fields**
    - **Validates: Requirements 18.1**

- [x] 22. Provision new DynamoDB tables and Lambda infrastructure in Terraform (`infra/terraform/main.tf`)
  - [x] 22.1 Add `aws_dynamodb_table` resources for `airline-price-alerts` (PK `userId`, SK `alertId`, GSI on `routeKey`), `airline-rebooking-history` (PK `userId`, SK `timestamp`), `airline-loyalty-transactions` (PK `userId`, SK `transactionId`), and `airline-notification-log` (PK `userId`, SK `notificationId`)
    - _Requirements: 16.1, 16.2, 16.3, 16.4_
  - [x] 22.2 Add `aws_lambda_function` resources for `fare-monitor`, `disruption-detector`, `rebooking-engine`, and `notification-worker`; add `data.archive_file` zip sources pointing to `lambdas/fare-monitor`, `lambdas/disruption-detector`, `lambdas/rebooking-engine`, `lambdas/notification-worker`
    - _Requirements: 17.3, 17.4_
  - [x] 22.3 Extend `aws_iam_role_policy.lambda_dynamodb` to grant the Lambda exec role read/write access to all four new DynamoDB tables and their indexes; add SES `SendEmail` permission for the notification-worker role
    - _Requirements: 17.3_
  - [x] 22.4 Add `aws_scheduler_schedule` resources for fare-monitor (rate 15 minutes) and disruption-detector (rate 5 minutes); add `aws_sqs_queue` DLQ resources and attach as `dead_letter_config` on each Lambda; add `aws_cloudwatch_metric_alarm` resources that trigger an SNS topic when DLQ depth > 0
    - _Requirements: 17.1, 17.2, 17.3, 17.5, 17.6_
  - [x] 22.5 Add `aws_cloudwatch_dashboard` resource with widgets for all metrics defined in Requirements 18.2; add `aws_cloudwatch_metric_alarm` resources for error rate > 5% over 5-minute window publishing to SNS
    - _Requirements: 18.2, 18.3, 18.4_

- [x] 23. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` with `numRuns: 100` and a comment header: `// Feature: realtime-flight-rebooking, Property N: <property_text>`
- All new Lambda handlers are Node.js 22.x, consistent with existing lambdas
- New DynamoDB table names are read from environment variables with hardcoded defaults matching the Terraform resource names
