# Requirements Document

## Introduction

This document defines requirements for the Airline Application — a full-stack system built on Next.js (frontend + API routes), AWS Lambda (backend logic), DynamoDB (data store), and Terraform (infrastructure). The application covers four core capability areas: user authentication, flight search, group booking and seating, and flight management.

## Glossary

- **System**: The Airline Application as a whole
- **Home_Page**: The welcome page at `/` with airline information and navigation
- **Search_Page**: The Next.js page at `/search` that allows users to find flights
- **Booking_Page**: The Next.js page at `/booking` that allows passengers to select multiple seats and create a group booking
- **Manage_Page**: The Next.js page at `/manage` used by airline staff to manage flights and seats
- **MyBookings_Page**: The Next.js page at `/my-bookings` where authenticated users view their booking history
- **Login_Page**: The Next.js page at `/login` for user authentication
- **Register_Page**: The Next.js page at `/register` for new user registration
- **Flights_API**: The Next.js API routes under `/api/flights`
- **Bookings_API**: The Next.js API routes under `/api/bookings`
- **Auth_API**: The NextAuth.js API routes under `/api/auth`
- **DB_Layer**: The `lib/db.ts` module that interfaces with DynamoDB
- **Flight**: A scheduled air travel segment with an origin, destination, date, departure time, arrival time, price, and seat inventory
- **Group_Booking**: A single confirmed reservation with one Booking_ID covering one or more Seats on a Flight, each mapped to a distinct Passenger
- **Seat**: A physical seat on a Flight with a seat number and a status of `available`, `reserved`, or `blocked`
- **Passenger**: A person assigned to a specific Seat within a Group_Booking, identified by name and email address
- **User**: A registered account holder who can sign in and view their booking history
- **Staff**: An airline employee who uses the Manage_Page to administer Flights and Seats
- **Booking_ID**: A unique identifier for a Group_Booking, formatted as `BK-` followed by 8 uppercase alphanumeric characters
- **Flight_ID**: A unique identifier for a Flight, formatted as `FL-` followed by a numeric suffix
- **Seat_Number**: A string identifying a seat position, composed of a row number and a column letter (e.g., `1A`, `4C`)

---

## Requirements

### Requirement 1: User Authentication

**User Story:** As a traveller, I want to register and sign in to AirApp, so that my bookings are tracked to my account.

#### Acceptance Criteria

1. WHEN a visitor submits a registration form with a valid name, email, and password (min 8 characters), THE Auth_API SHALL create a new User account and return status 201.
2. IF a registration request is submitted with an email that already exists, THEN THE Auth_API SHALL return a 409 error.
3. THE System SHALL store passwords as bcrypt hashes — plaintext passwords SHALL NOT be persisted.
4. WHEN a User submits valid credentials on the Login_Page, THE System SHALL create a JWT session and redirect the User to the home page.
5. IF invalid credentials are submitted, THEN THE Login_Page SHALL display an error message.
6. WHEN a User is signed in, THE Navbar SHALL display the user's name and a Sign Out button.
7. WHEN a User signs out, THE System SHALL invalidate the session and redirect to the home page.
8. THE System SHALL use NextAuth.js v5 with a credentials provider backed by the `airline-users` DynamoDB table.

---

### Requirement 2: Flight Search

**User Story:** As a Passenger, I want to search for available flights by origin, destination, and date, so that I can find a flight that fits my travel plans.

#### Acceptance Criteria

1. WHEN a Passenger submits a search with a valid origin, destination, and date, THE Search_Page SHALL display all matching Flights returned by the Flights_API.
2. WHEN a Passenger submits a search with only an origin or only a destination, THE Flights_API SHALL return all Flights matching the provided filter.
3. WHEN a Passenger submits a search with no filters, THE Flights_API SHALL return all Flights in the system.
4. THE Search_Page SHALL display each Flight's Flight_ID, origin, destination, date, departure time, arrival time, price, and available seat count.
5. WHEN a Passenger clicks "Book" on a Flight card, THE Search_Page SHALL navigate to the Booking_Page with the selected Flight_ID pre-populated.
6. WHEN the Flights_API receives a search request with both origin and destination, THE DB_Layer SHALL query Flights using the `route-date-index` DynamoDB GSI.
7. WHEN no Flights match the search criteria, THE Search_Page SHALL display a message indicating no flights were found.
8. WHILE a search request is in progress, THE Search_Page SHALL display a loading indicator.

---

### Requirement 3: Group Seat Selection and Booking

**User Story:** As a Passenger, I want to select multiple seats and enter each traveller's details in a single booking, so that my group gets one Booking_ID covering all seats.

#### Acceptance Criteria

1. WHEN a Passenger loads the Booking_Page with a valid Flight_ID, THE Booking_Page SHALL display the seat map for that Flight showing all Seats and their statuses.
2. THE Booking_Page SHALL visually distinguish `available` (green), `reserved` (red), and `blocked` (gray) Seats.
3. WHEN a Passenger clicks an `available` Seat, THE Booking_Page SHALL toggle it as selected (blue) and display a traveller detail form for that seat.
4. WHEN a Passenger clicks a selected Seat again, THE Booking_Page SHALL deselect it and remove its traveller form.
5. WHEN a Passenger submits a booking with one or more selected seats and valid traveller details for each, THE Bookings_API SHALL create a single Group_Booking and return it with status 201.
6. THE Group_Booking SHALL contain one Booking_ID and a `passengers` array mapping each Seat_Number to a passengerName and passengerEmail.
7. WHEN a booking is created successfully, THE DB_Layer SHALL atomically reserve all selected Seats, decrement `availableSeats` by the number of passengers, and persist the Group_Booking record in a single DynamoDB transaction.
8. IF any selected Seat is not `available` at transaction time, THE Bookings_API SHALL return a 400 error and no seats SHALL be reserved.
9. IF the Flight does not have enough available seats for the group size, THE Bookings_API SHALL return a 400 error before attempting the transaction.
10. WHEN a booking is created successfully, THE Booking_Page SHALL display the Booking_ID with a list of seat-to-passenger mappings as a confirmation.
11. WHEN a booking is created successfully, THE Booking_Page SHALL reload the seat map to reflect updated Seat statuses.
12. THE Bookings_API SHALL require an authenticated session; unauthenticated requests SHALL receive a 401 error.
13. THE Booking_Page SHALL display a total price (price per seat × number of selected seats) before submission.

---

### Requirement 4: Booking Retrieval

**User Story:** As a Passenger, I want to retrieve my booking details using a Booking_ID, so that I can confirm my reservation information.

#### Acceptance Criteria

1. WHEN a valid Booking_ID is provided to the Bookings_API, THE Bookings_API SHALL return the full Group_Booking record including Flight_ID, userId, passengers array, status, and creation timestamp.
2. IF an invalid or non-existent Booking_ID is provided, THEN THE Bookings_API SHALL return a 404 error with a descriptive message.
3. WHEN an authenticated User loads the MyBookings_Page, THE System SHALL automatically display all Group_Bookings associated with that User's account.
4. THE MyBookings_Page SHALL also allow any visitor to look up a booking by Booking_ID without requiring authentication.

---

### Requirement 5: Flight Management — List and View

**User Story:** As a Staff member, I want to view all flights in the system, so that I can monitor the current flight schedule and seat availability.

#### Acceptance Criteria

1. WHEN a Staff member loads the Manage_Page, THE Manage_Page SHALL automatically load and display all Flights.
2. WHEN Flights are loaded, THE Manage_Page SHALL display each Flight's Flight_ID, route, date, departure time, arrival time, available/total seat count, and status.
3. THE Manage_Page SHALL provide a "Book" button per flight row that navigates to the Booking_Page for that flight.
4. WHEN the Flights_API receives a request with no filters, THE DB_Layer SHALL return all Flights via a DynamoDB scan.

---

### Requirement 6: Flight Management — Reschedule

**User Story:** As a Staff member, I want to change the scheduled date and/or time of a flight, so that I can keep the schedule accurate when operational changes occur.

#### Acceptance Criteria

1. WHEN a Staff member submits a reschedule request with a valid Flight_ID, new date, new departure time, and new arrival time, THE Flights_API SHALL update the Flight record and return the updated Flight.
2. IF a reschedule request is submitted with a Flight_ID that does not exist, THEN THE Flights_API SHALL return a 404 error.
3. IF a reschedule request is submitted with a missing or invalid date, departure time, or arrival time, THEN THE Flights_API SHALL return a 400 error.
4. THE Manage_Page SHALL provide a form for Staff to enter a Flight_ID, new date, new departure time, and new arrival time.
5. WHEN a reschedule is successful, THE Manage_Page SHALL display the updated Flight details and refresh the flight list.

---

### Requirement 7: Flight Management — Cancellation

**User Story:** As a Staff member, I want to cancel a flight, so that passengers and systems are informed when a flight will not operate.

#### Acceptance Criteria

1. WHEN a Staff member submits a cancellation request with a valid Flight_ID, THE Flights_API SHALL mark the Flight as `cancelled` and return the updated Flight record.
2. WHEN a Flight is cancelled, THE DB_Layer SHALL update all `available` and `reserved` Seats on that Flight to `blocked`.
3. WHEN a Flight is cancelled, THE DB_Layer SHALL update all confirmed Group_Bookings on that Flight to `cancelled` status.
4. IF a cancellation request is submitted with a Flight_ID that does not exist, THEN THE Flights_API SHALL return a 404 error.
5. IF a Staff member attempts to cancel a Flight that is already `cancelled`, THEN THE Flights_API SHALL return a 400 error.
6. THE Manage_Page SHALL require a confirmation step before submitting a cancellation.
7. WHEN a cancellation is successful, THE Manage_Page SHALL display a confirmation message and refresh the Flight list.

---

### Requirement 8: Seat Status Management

**User Story:** As a Staff member, I want to manually update the status of individual seats, so that I can block seats for maintenance or unblock them when they become available.

#### Acceptance Criteria

1. WHEN a Staff member submits a seat update with a valid Flight_ID, Seat_Number, and target status, THE Flights_API SHALL update the Seat status and return the updated Seat.
2. IF a seat update request references a Flight_ID or Seat_Number that does not exist, THEN THE Flights_API SHALL return a 404 error.
3. IF a seat update request is submitted with a missing `seatNumber` or `status`, THEN THE Flights_API SHALL return a 400 error.
4. THE Manage_Page SHALL provide controls for Staff to enter a Flight_ID, Seat_Number, and choose a target status (`available`, `reserved`, `blocked`).
5. WHEN a seat update is successful, THE Manage_Page SHALL display the updated Seat_Number and its new status.

---

### Requirement 9: Data Integrity and Concurrency

**User Story:** As a system operator, I want booking and seat operations to be atomic, so that seat double-booking and inventory inconsistencies cannot occur.

#### Acceptance Criteria

1. WHEN two Passengers attempt to book the same Seat on the same Flight simultaneously, THE DB_Layer SHALL ensure only one Booking succeeds and the other receives an error.
2. THE DB_Layer SHALL use a single DynamoDB `TransactWriteCommand` to atomically reserve all seats, decrement `availableSeats`, and create the Group_Booking record.
3. IF the DynamoDB transaction fails due to a condition check, THEN THE Bookings_API SHALL return a 400 error with a descriptive message.
4. THE DB_Layer SHALL use a DynamoDB conditional expression on each Seat record requiring `status = available` before allowing reservation.

---

### Requirement 10: Input Validation

**User Story:** As a system operator, I want all API inputs to be validated before processing, so that invalid data does not corrupt the data store.

#### Acceptance Criteria

1. THE Flights_API SHALL validate that origin and destination airport codes are 3-character uppercase strings when provided as search filters.
2. THE Bookings_API SHALL validate that each `passengerEmail` in the passengers array conforms to a valid email address format.
3. THE Bookings_API SHALL validate that each `passengerName` is a non-empty string with a maximum length of 100 characters.
4. THE Flights_API SHALL validate that rescheduled dates conform to the `YYYY-MM-DD` format.
5. THE Flights_API SHALL validate that rescheduled departure and arrival times conform to the `HH:MM` 24-hour format.
6. IF any validation check fails, THEN THE relevant API SHALL return a 400 error with a message identifying the invalid field.

---

### Requirement 11: Navigation and User Experience

**User Story:** As a user, I want clear navigation across all pages, so that I can move between search, booking, and account management without getting lost.

#### Acceptance Criteria

1. THE System SHALL display a persistent Navbar on all pages with links to: Home, Search Flights, Manage, and My Bookings.
2. WHEN a User is signed in, THE Navbar SHALL display the user's name and a Sign Out button.
3. WHEN a User is not signed in, THE Navbar SHALL display Sign In and Register links.
4. THE Home_Page SHALL display a welcome hero section, benefit cards, a "How it works" section, and CTAs to search flights and view bookings.
5. THE Booking_Page SHALL display breadcrumb navigation links (Back, Search Flights, My Bookings).
6. WHEN a booking is confirmed, THE Booking_Page SHALL display each Booking_ID as a clickable link to the MyBookings_Page pre-filled with that ID.
7. THE Manage_Page flight table SHALL include a "Book" button per row that navigates to the Booking_Page for that flight (disabled for cancelled flights).

---

### Requirement 12: Infrastructure and Deployment

**User Story:** As a developer, I want the application infrastructure to be defined as code, so that environments can be provisioned and torn down reliably.

#### Acceptance Criteria

1. THE System SHALL provision DynamoDB tables for Flights, Seats, Bookings, and Users via Terraform in `infra/terraform/`.
2. THE `airline-users` table SHALL have a `email-index` GSI for efficient user lookup by email.
3. THE `airline-bookings` table SHALL have a `userId-index` GSI for efficient per-user booking queries.
4. THE System SHALL deploy Lambda functions for flight search, seat retrieval, booking creation, booking retrieval, and flight management via Terraform.
5. WHERE `NEXT_PUBLIC_API_URL` is set, THE System SHALL route API calls to the configured AWS API Gateway URL instead of local Next.js API routes.
6. THE DB_Layer SHALL read table names and AWS region from environment variables, falling back to defaults when not set.
7. WHEN the DynamoDB tables are empty on first access, THE DB_Layer SHALL seed the tables with a default set of Flights and their corresponding Seat maps.
