export type SeatStatus = "available" | "reserved" | "blocked";

export type FlightStatus = "active" | "cancelled";

export type Flight = {
  id: string;
  from: string;
  to: string;
  date: string;
  departureTime: string;
  arrivalTime: string;
  price: number;
  totalSeats: number;
  availableSeats: number;
  status?: FlightStatus;
};

export type Seat = {
  seatNumber: string;
  status: SeatStatus;
  bookingId?: string;
};

export type BookingPassenger = {
  seatNumber: string;
  passengerName: string;
  passengerEmail: string;
};

export type AncillaryItem = {
  type: string;
  name: string;
  price: number;
  addedAt: string;
};

export type Booking = {
  id: string;
  flightId: string;
  userId: string;
  passengers: BookingPassenger[];
  status: "confirmed" | "cancelled";
  createdAt: string;
  // legacy single-passenger fields (kept for backward compat)
  passengerName?: string;
  passengerEmail?: string;
  seatNumber?: string;
  autoRebook?: boolean;
  ancillaries?: AncillaryItem[];
  refund?: { amount: number; timestamp: string; reference: string };
  manualReview?: boolean;
};

export type User = {
  id: string;
  name: string;
  email: string;
  passwordHash: string | null;
  createdAt: string;
  googleId?: string;
  pictureUrl?: string;
  loyaltyPoints?: number;
  notificationPreferences?: { inApp: boolean; email: boolean };
};

export type PriceAlert = {
  userId: string;
  alertId: string;
  routeKey: string; // "ORD#JFK" — GSI PK
  departureDate?: string;
  threshold: number; // USD
  createdAt: string;
  lastCheckedAt?: string;
  status: "active" | "triggered" | "expired";
};

export type RebookingHistory = {
  userId: string;
  timestamp: string;
  originalBookingId: string;
  newBookingId: string;
  fareSaved: number;
  trigger: "auto" | "manual" | "disruption";
};

export type LoyaltyTransaction = {
  userId: string;
  transactionId: string;
  type: "booking" | "ancillary" | "rebooking_saving" | "cancellation";
  points: number;
  referenceId: string;
  timestamp: string;
};

export type NotificationLog = {
  userId: string;
  notificationId: string;
  channel: "inApp" | "email";
  message: string;
  sentAt: string;
  status: "sent" | "suppressed" | "failed";
  read?: boolean;
};
