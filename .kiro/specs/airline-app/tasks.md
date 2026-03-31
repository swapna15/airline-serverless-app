# Implementation Tasks

## Task 1: Types and validation helpers
- [x] 1.1 Add `FlightStatus`, `BookingPassenger`, `User` types and extend `Flight` and `Booking` in `lib/types.ts`
- [x] 1.2 Create `lib/validation.ts` with `isValidIATA`, `isValidDate`, `isValidTime`, `isValidEmail`, `isValidName`

---

## Task 2: Database layer
- [x] 2.1 Add `updateFlightSchedule` to `lib/db.ts`
- [x] 2.2 Add `cancelFlight` to `lib/db.ts` (cascades seats + bookings)
- [x] 2.3 Update `createBooking` to accept `{ flightId, userId, passengers[] }` and use a single atomic transaction for all seats
- [x] 2.4 Add `createUser`, `getUserByEmail` (GSI + scan fallback), `getUserById`, `getBookingsByUserId` (GSI + scan fallback)

---

## Task 3: API client (`lib/api.ts`)
- [x] 3.1 Add `rescheduleFlight`, `cancelFlight`, `getBooking`, `getMyBookings`
- [x] 3.2 Update `createBooking` to accept `{ flightId, passengers[] }`

---

## Task 4: API routes — validation and new endpoints
- [x] 4.1 `app/api/flights/route.ts` — IATA + date validation
- [x] 4.2 `app/api/flights/[flightId]/route.ts` — PATCH reschedule, DELETE cancel
- [x] 4.3 `app/api/flights/[flightId]/seats/route.ts` — status enum validation, 404 on missing flight/seat
- [x] 4.4 `app/api/bookings/route.ts` — POST group booking (auth required), GET user bookings (auth required)
- [x] 4.5 `app/api/bookings/[bookingId]/route.ts` — GET with 404 handling

---

## Task 5: Authentication
- [x] 5.1 Create `auth.ts` — NextAuth v5 credentials provider, JWT strategy, `signIn`/`signOut`/`auth` exports
- [x] 5.2 Create `app/api/auth/[...nextauth]/route.ts` — NextAuth route handler
- [x] 5.3 Create `app/api/auth/register/route.ts` — user registration with bcrypt hashing
- [x] 5.4 Create `app/actions/auth.ts` — `signInAction` and `signOutAction` server actions
- [x] 5.5 Update `app/layout.tsx` to server component — reads session via `auth()`, passes user to Navbar
- [x] 5.6 Add `AUTH_SECRET`, `AUTH_URL`, `AUTH_TRUST_HOST`, `DDB_USERS_TABLE` to `.env.local`

---

## Task 6: Pages
- [x] 6.1 `app/page.tsx` — welcome page with hero, stats, benefits, how-it-works, CTA
- [x] 6.2 `app/search/page.tsx` — search form, flight cards, Book button
- [x] 6.3 `app/booking/page.tsx` — multi-seat map, per-seat traveller forms, group booking submission, confirmation with Booking_ID link
- [x] 6.4 `app/manage/page.tsx` — flight table with Book button, reschedule form, cancel with confirmation, seat update form
- [x] 6.5 `app/my-bookings/page.tsx` — auto-loads user bookings, lookup-by-ID form, auto-fills from `?id=` query param
- [x] 6.6 `app/login/page.tsx` — calls `signInAction` server action, handles NEXT_REDIRECT as success
- [x] 6.7 `app/register/page.tsx` — POSTs to `/api/auth/register`, redirects to login on success
- [x] 6.8 `app/components/Navbar.tsx` — receives user prop, Sign Out via server action, active link highlight
- [x] 6.9 `app/FlightIdBookingLink.tsx` — inline flight ID input on home page

---

## Task 7: Lambda updates
- [x] 7.1 Update `lambdas/createbooking/index.js` to group booking model (`passengers[]`, atomic multi-seat transaction, AWS SDK v3)
- [x] 7.2 Update `lambdas/getbooking/index.js` to AWS SDK v3
- [x] 7.3 Create `lambdas/manageflight/index.js` — PATCH reschedule + DELETE cancel

---

## Task 8: Terraform infrastructure
- [x] 8.1 Add `airline-users` table with `email-index` GSI
- [x] 8.2 Add `userId-index` GSI to `airline-bookings` table
- [x] 8.3 Add `manageflight` Lambda + API Gateway routes (PATCH + DELETE `/api/flights/{flightId}`)
- [x] 8.4 Update CORS to include DELETE method
- [x] 8.5 Update IAM policy to include users table and new GSI ARNs
- [x] 8.6 Add `users_table_name` output
