# Technical Design Document — Airline Application

## 1. System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Browser (Next.js)                      │
│  /  /search  /booking  /manage  /my-bookings  /login  /register │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTP (axios via lib/api.ts)
           ┌────────────────┴───────────────┐
           │  NEXT_PUBLIC_API_URL set?        │
           │  No  → Next.js API Routes        │
           │  Yes → AWS API Gateway HTTP API  │
           └────────────────┬───────────────┘
                            │
       ┌────────────────────┴──────────────────┐
       │          Next.js API Routes             │  ← local / Vercel
       │  /api/auth/[...nextauth]  (NextAuth v5) │
       │  /api/auth/register                     │
       │  /api/flights                           │
       │  /api/flights/[flightId]                │
       │  /api/flights/[flightId]/seats          │
       │  /api/bookings          (GET + POST)    │
       │  /api/bookings/[bookingId]              │
       └────────────────────┬──────────────────┘
                            │ lib/db.ts (AWS SDK v3)
                            │
       ┌────────────────────┴──────────────────┐
       │              AWS DynamoDB              │
       │  airline-flights                       │
       │  airline-seats                         │
       │  airline-bookings  (userId-index GSI)  │
       │  airline-users     (email-index GSI)   │
       └────────────────────────────────────────┘

       ┌────────────────────────────────────────┐
       │       AWS Lambda (serverless path)      │
       │  airline-search-flights                 │
       │  airline-flight-seats                   │
       │  airline-create-booking  (updated)      │
       │  airline-get-booking     (updated)      │
       │  airline-manage-flight                  │
       └────────────────────┬──────────────────┘
                            │ AWS API Gateway HTTP API
                            └── same DynamoDB tables
```

Auth (NextAuth v5) runs only on the Next.js server — it is not proxied through API Gateway. The Lambda path handles flight and booking operations only.

---

## 2. Data Models

### 2.1 Flight (DynamoDB: `airline-flights`)

| Attribute      | Type   | Notes                                      |
|----------------|--------|--------------------------------------------|
| id             | String | PK — `FL-{number}`                         |
| route          | String | GSI PK — `{from}#{to}` e.g. `ORD#JFK`     |
| from           | String | 3-char IATA code                           |
| to             | String | 3-char IATA code                           |
| date           | String | `YYYY-MM-DD`                               |
| departureTime  | String | `HH:MM` 24-hour                            |
| arrivalTime    | String | `HH:MM` 24-hour                            |
| price          | Number |                                            |
| totalSeats     | Number |                                            |
| availableSeats | Number | decremented atomically on booking          |
| status         | String | `active` \| `cancelled` (default `active`) |

GSI: `route-date-index` — hash key `route`.

### 2.2 Seat (DynamoDB: `airline-seats`)

| Attribute  | Type   | Notes                                    |
|------------|--------|------------------------------------------|
| flightId   | String | PK                                       |
| seatNumber | String | SK — e.g. `1A`                           |
| status     | String | `available` \| `reserved` \| `blocked`   |
| bookingId  | String | set when reserved, removed when released |

### 2.3 Group Booking (DynamoDB: `airline-bookings`)

| Attribute  | Type   | Notes                                        |
|------------|--------|----------------------------------------------|
| id         | String | PK — `BK-{8 alphanumeric}`                   |
| flightId   | String |                                              |
| userId     | String | GSI PK on `userId-index` — owner's user ID   |
| passengers | List   | Array of `{ seatNumber, passengerName, passengerEmail }` |
| status     | String | `confirmed` \| `cancelled`                   |
| createdAt  | String | ISO 8601                                     |

GSI: `userId-index` — hash key `userId` — enables `GET /api/bookings` to fetch all bookings for a user.

### 2.4 User (DynamoDB: `airline-users`)

| Attribute    | Type   | Notes                                    |
|--------------|--------|------------------------------------------|
| id           | String | PK — UUID                                |
| email        | String | GSI PK on `email-index` — lowercase      |
| name         | String |                                          |
| passwordHash | String | bcrypt hash (cost 10)                    |
| createdAt    | String | ISO 8601                                 |

GSI: `email-index` — hash key `email` — enables credential lookup. Falls back to table scan if GSI not yet provisioned.

---

## 3. TypeScript Types (`lib/types.ts`)

```ts
export type SeatStatus = "available" | "reserved" | "blocked";
export type FlightStatus = "active" | "cancelled";

export type Flight = {
  id: string; from: string; to: string; date: string;
  departureTime: string; arrivalTime: string;
  price: number; totalSeats: number; availableSeats: number;
  status?: FlightStatus;
};

export type Seat = {
  seatNumber: string; status: SeatStatus; bookingId?: string;
};

export type BookingPassenger = {
  seatNumber: string; passengerName: string; passengerEmail: string;
};

export type Booking = {
  id: string; flightId: string; userId: string;
  passengers: BookingPassenger[];
  status: "confirmed" | "cancelled"; createdAt: string;
};

export type User = {
  id: string; name: string; email: string;
  passwordHash: string; createdAt: string;
};
```

---

## 4. Authentication (`auth.ts` + NextAuth v5)

- Provider: `Credentials` — email + password
- Session strategy: `JWT` (stateless, stored in httpOnly cookie)
- `authorize()` calls `getUserByEmail()` then `bcrypt.compare()`
- `jwt` callback stores `user.id` in the token
- `session` callback exposes `session.user.id`
- Sign-in uses a **server action** (`app/actions/auth.ts → signInAction`) to avoid client-side NextAuth fetch issues
- Sign-out uses a **server action** (`signOutAction`)
- Layout reads session server-side via `auth()` and passes user as prop to Navbar — no `SessionProvider` or `useSession` needed
- Required env vars: `AUTH_SECRET` (hex string), `AUTH_URL=http://localhost:3000`, `AUTH_TRUST_HOST=true`

---

## 5. API Contract

### 5.1 Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create user account |
| POST | `/api/auth/callback/credentials` | NextAuth sign-in (via server action) |
| POST | `/api/auth/signout` | NextAuth sign-out (via server action) |

### 5.2 Flights

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/flights` | Search flights (`from?`, `to?`, `date?`) |
| PATCH | `/api/flights/[flightId]` | Reschedule flight |
| DELETE | `/api/flights/[flightId]` | Cancel flight (cascades to seats + bookings) |
| GET | `/api/flights/[flightId]/seats` | Get flight + seat map |
| PATCH | `/api/flights/[flightId]/seats` | Update individual seat status |

### 5.3 Bookings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/bookings` | Required | Create group booking |
| GET | `/api/bookings` | Required | Get all bookings for current user |
| GET | `/api/bookings/[bookingId]` | None | Get booking by ID |

#### `POST /api/bookings` body:
```json
{
  "flightId": "FL-1001",
  "passengers": [
    { "seatNumber": "1A", "passengerName": "Alice", "passengerEmail": "alice@example.com" },
    { "seatNumber": "1B", "passengerName": "Bob",   "passengerEmail": "bob@example.com" }
  ]
}
```

---

## 6. Component Design

### 6.1 Layout (`app/layout.tsx`)
Server component. Calls `auth()` to get session, passes `user` prop to `<Navbar>`. Wraps all pages.

### 6.2 Navbar (`app/components/Navbar.tsx`)
Client component. Receives `user` prop from layout. Shows nav links + auth state. Sign-out calls `signOutAction` server action.

### 6.3 `/` — Home Page
Static server component. Hero, stats bar, 6 benefit cards, 3-step "How it works", CTA.

### 6.4 `/search` — Search Page
Client component. State: `{ from, to, date, flights[], loading, error, searched }`. Calls `searchFlights()`. Each result card has a "Book" button → `/booking?flightId=`.

### 6.5 `/booking` — Booking Page
Client component wrapped in `<Suspense>`. Reads `flightId` from query string. Multi-seat selection: clicking a seat toggles it and adds/removes a traveller form. On submit calls `createBooking({ flightId, passengers[] })`. Shows single Booking_ID confirmation with per-seat passenger summary. Reloads seat map after success.

### 6.6 `/manage` — Manage Page
Client component. Sections: flight table (with Book button per row), reschedule form, cancel form (with confirmation step), seat update form.

### 6.7 `/my-bookings` — My Bookings Page
Client component wrapped in `<Suspense>`. On mount calls `GET /api/bookings` — shows all user bookings if authenticated (401 → shows "sign in" prompt). Also has a lookup-by-ID form for any visitor. Auto-fills ID from `?id=` query param.

### 6.8 `/login` — Login Page
Client component. Calls `signInAction(email, password, callbackUrl)` server action on submit. Handles `NEXT_REDIRECT` thrown by NextAuth as a success case.

### 6.9 `/register` — Register Page
Client component. POSTs to `/api/auth/register` via axios. Redirects to `/login?registered=1` on success.

---

## 7. Database Layer (`lib/db.ts`) — Key Functions

| Function | Description |
|----------|-------------|
| `getFlights(filters?)` | Search/scan flights |
| `getFlightById(id)` | Get single flight |
| `getSeatsByFlightId(id)` | Get all seats for a flight |
| `updateSeatStatus(flightId, seatNumber, status)` | Manual seat update |
| `createBooking({ flightId, userId, passengers[] })` | Atomic group booking transaction |
| `getBookingById(id)` | Get booking by ID |
| `getBookingsByUserId(userId)` | Get all bookings for a user (GSI with scan fallback) |
| `updateFlightSchedule(flightId, data)` | Reschedule flight |
| `cancelFlight(flightId)` | Cancel flight + cascade seats + bookings |
| `createUser(data)` | Register new user |
| `getUserByEmail(email)` | Lookup user for auth (GSI with scan fallback) |
| `getUserById(id)` | Get user by ID |

---

## 8. Concurrency Strategy

`createBooking` uses a single `TransactWriteCommand` with:
- One `Update` per seat — condition: `#status = :available`
- One `Update` on flight — condition: `availableSeats >= :count`
- One `Put` for the booking record — condition: `attribute_not_exists(id)`

If any condition fails, DynamoDB rolls back the entire transaction. The API returns `400`. This prevents double-booking without application-level locking.

---

## 9. Validation (`lib/validation.ts`)

| Helper | Rule |
|--------|------|
| `isValidIATA(code)` | `/^[A-Z]{3}$/` |
| `isValidDate(date)` | `/^\d{4}-\d{2}-\d{2}$/` |
| `isValidTime(time)` | `/^\d{2}:\d{2}$/` |
| `isValidEmail(email)` | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| `isValidName(name)` | non-empty string, max 100 chars |

---

## 10. Infrastructure (`infra/terraform/main.tf`)

| Resource | Notes |
|----------|-------|
| `aws_dynamodb_table.flights` | `route-date-index` GSI |
| `aws_dynamodb_table.seats` | PK: flightId, SK: seatNumber |
| `aws_dynamodb_table.bookings` | `userId-index` GSI |
| `aws_dynamodb_table.users` | `email-index` GSI |
| `aws_lambda_function.search_flights` | `lambdas/searchflights` |
| `aws_lambda_function.flight_seats` | `lambdas/flightseats` |
| `aws_lambda_function.create_booking` | `lambdas/createbooking` (group booking model) |
| `aws_lambda_function.get_booking` | `lambdas/getbooking` |
| `aws_lambda_function.manage_flight` | `lambdas/manageflight` (reschedule + cancel) |
| `aws_apigatewayv2_api.airline_http_api` | HTTP API, CORS: GET/POST/PATCH/DELETE |

---

## 11. File Map

| File | Purpose |
|------|---------|
| `auth.ts` | NextAuth v5 config — credentials provider, JWT callbacks |
| `lib/types.ts` | All TypeScript types |
| `lib/validation.ts` | Input validation helpers |
| `lib/db.ts` | DynamoDB operations |
| `lib/api.ts` | Axios client functions for all API endpoints |
| `app/actions/auth.ts` | Server actions: `signInAction`, `signOutAction` |
| `app/layout.tsx` | Root layout — server component, reads session |
| `app/components/Navbar.tsx` | Client navbar — receives user prop |
| `app/page.tsx` | Welcome/home page |
| `app/search/page.tsx` | Flight search UI |
| `app/booking/page.tsx` | Multi-seat booking UI |
| `app/manage/page.tsx` | Staff flight management UI |
| `app/my-bookings/page.tsx` | User booking history + lookup |
| `app/login/page.tsx` | Sign-in form |
| `app/register/page.tsx` | Registration form |
| `app/api/auth/[...nextauth]/route.ts` | NextAuth route handler |
| `app/api/auth/register/route.ts` | User registration endpoint |
| `app/api/flights/route.ts` | GET flights |
| `app/api/flights/[flightId]/route.ts` | PATCH reschedule, DELETE cancel |
| `app/api/flights/[flightId]/seats/route.ts` | GET seat map, PATCH seat status |
| `app/api/bookings/route.ts` | POST create booking, GET user bookings |
| `app/api/bookings/[bookingId]/route.ts` | GET booking by ID |
| `lambdas/createbooking/index.js` | Group booking Lambda (AWS SDK v3) |
| `lambdas/getbooking/index.js` | Get booking Lambda (AWS SDK v3) |
| `lambdas/manageflight/index.js` | Reschedule + cancel Lambda |
| `lambdas/searchflights/index.js` | Search flights Lambda |
| `lambdas/flightseats/index.js` | Seat map Lambda |
| `infra/terraform/main.tf` | All AWS infrastructure as code |
