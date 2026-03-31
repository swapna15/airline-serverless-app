import {
  cancelFlight,
  createBooking,
  getBookingById,
  getBookingsByUserId,
  getFlightById,
  getFlights,
  getSeatsByFlightId,
} from "@/lib/db";

export type ToolContext = {
  userId?: string;
};

export type AgentTool = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
};

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "search_flights",
    description: "Search for available flights. Optionally filter by origin airport (from), destination airport (to), and date.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Origin airport IATA code (e.g. ORD)" },
        to: { type: "string", description: "Destination airport IATA code (e.g. JFK)" },
        date: { type: "string", description: "Travel date in YYYY-MM-DD format" },
      },
    },
    async execute(args) {
      try {
        const flights = await getFlights({
          from: args.from as string | undefined,
          to: args.to as string | undefined,
          date: args.date as string | undefined,
        });
        return { flights };
      } catch (err) {
        return { error: `Failed to search flights: ${(err as Error).message}` };
      }
    },
  },

  {
    name: "get_flight_seats",
    description: "Get the seat map for a specific flight, showing which seats are available, reserved, or blocked.",
    inputSchema: {
      type: "object",
      properties: {
        flightId: { type: "string", description: "The flight ID (e.g. FL-1001)" },
      },
      required: ["flightId"],
    },
    async execute(args) {
      try {
        const flight = await getFlightById(args.flightId as string);
        if (!flight) return { error: `Flight ${args.flightId} not found.` };
        const seats = await getSeatsByFlightId(args.flightId as string);
        return { flight, seats };
      } catch (err) {
        return { error: `Failed to get seats: ${(err as Error).message}` };
      }
    },
  },

  {
    name: "create_booking",
    description: "Create a booking for one or more seats on a flight. Requires the user to be signed in.",
    inputSchema: {
      type: "object",
      properties: {
        flightId: { type: "string", description: "The flight ID to book" },
        passengers: {
          type: "array",
          description: "List of passengers, one per seat",
          items: {
            type: "object",
            properties: {
              seatNumber: { type: "string", description: "Seat number (e.g. 1A)" },
              passengerName: { type: "string", description: "Full name of the passenger" },
              passengerEmail: { type: "string", description: "Email address of the passenger" },
            },
            required: ["seatNumber", "passengerName", "passengerEmail"],
          },
        },
      },
      required: ["flightId", "passengers"],
    },
    async execute(args, context) {
      if (!context.userId) {
        return { error: "You must be signed in to create a booking. Please sign in first." };
      }
      try {
        const result = await createBooking({
          flightId: args.flightId as string,
          userId: context.userId,
          passengers: args.passengers as { seatNumber: string; passengerName: string; passengerEmail: string }[],
        });
        if (!result.booking) return { error: result.message };
        return { booking: result.booking };
      } catch (err) {
        return { error: `Failed to create booking: ${(err as Error).message}` };
      }
    },
  },

  {
    name: "get_booking",
    description: "Retrieve the details of a booking by its Booking ID.",
    inputSchema: {
      type: "object",
      properties: {
        bookingId: { type: "string", description: "The booking ID (e.g. BK-A1B2C3D4)" },
      },
      required: ["bookingId"],
    },
    async execute(args) {
      try {
        const booking = await getBookingById(args.bookingId as string);
        if (!booking) return { error: `Booking ${args.bookingId} not found.` };
        return { booking };
      } catch (err) {
        return { error: `Failed to get booking: ${(err as Error).message}` };
      }
    },
  },

  {
    name: "get_my_bookings",
    description: "Get all bookings for the currently signed-in user.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    async execute(_args, context) {
      if (!context.userId) {
        return { error: "You must be signed in to view your bookings." };
      }
      try {
        const bookings = await getBookingsByUserId(context.userId);
        return { bookings };
      } catch (err) {
        return { error: `Failed to get bookings: ${(err as Error).message}` };
      }
    },
  },

  {
    name: "cancel_flight",
    description: "Cancel a flight by its Flight ID. This will block all seats and cancel all confirmed bookings on that flight.",
    inputSchema: {
      type: "object",
      properties: {
        flightId: { type: "string", description: "The flight ID to cancel (e.g. FL-1001)" },
      },
      required: ["flightId"],
    },
    async execute(args) {
      try {
        const result = await cancelFlight(args.flightId as string);
        if (!result.flight) return { error: result.message };
        return { flight: result.flight };
      } catch (err) {
        return { error: `Failed to cancel flight: ${(err as Error).message}` };
      }
    },
  },
];

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<unknown> {
  const tool = AGENT_TOOLS.find((t) => t.name === name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  return tool.execute(args, context);
}
