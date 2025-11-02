import z from 'zod';
import { toolBuilder } from '../src/builder.js';
import { AirlineSchedule, FlightEntry, FlightFilters } from './airline-schedule.js';
import { uniq } from './utils.js';
import { Tool2Agent } from '../src/tool2agent.js';

// This code is runnable with `pnpm run example:airline-booking-chat` from the `packages/ai` directory.
// The entry point is packages/ai/examples/airline-booking-chat.ts

// This example demonstrates how to use `toolBuilder()` to define a tool that:
// - is interactive
// - maintains ordering of parameter filling (via dependencies between fields) - which effectively guides the
//   assistant towards asking the user the right questions
// - provides rich feedback to the LLM based on provided values

// Our domain type for airline bookings. All fields are required.
export const airlineBookingSchema = z.object({
  departure: z.string().min(1),
  arrival: z.string().min(1),
  date: z.string().min(1),
  passengers: z.number().min(1),
});

// Partial schema for LLM inputs - at runtime, all dynamic parameters are made optional
export const bookingInputSchema = airlineBookingSchema.partial();
export type BookingInput = z.infer<typeof bookingInputSchema>;

export type AirlineBooking = z.infer<typeof airlineBookingSchema>;

// Create a tool to book a flight from a pre-defined list.
export const mkAirlineBookingTool = (
  // list of available flights
  flights: FlightEntry[],
  // callback used for testing purposes
  execute: (input: AirlineBooking) => Promise<AirlineBooking>,
): Tool2Agent<BookingInput, AirlineBooking> => {
  // schedule object contains some useful methods for filtering and querying the flights.
  const schedule = new AirlineSchedule(flights);
  // Abort controller to kill LLM inference as soon as we get the response and save some tokens
  const responseReceivedController = new AbortController();
  // Here we define our tool using a builder:
  const dynamic = ['passengers', 'date', 'arrival', 'departure'] as const;
  const tool = toolBuilder({
    inputSchema: airlineBookingSchema,
    outputSchema: airlineBookingSchema,
    dynamicFields: dynamic,
    description: 'Airline booking tool.',
    // we are not doing anything here, just returning the input,
    // that's why both input and output schemas are the same: `AirlineBookingSchema`
    execute: async (input: AirlineBooking) => {
      // call the callback to simulate the tool execution
      await execute(input);
      // stop the inference
      responseReceivedController.abort();
      return input;
    },
  })
    // Begin describing our tool interface:
    .field('departure', {
      // `requires` field introduces dependencies between fields.
      // These dependencies allow us to specify the order in which we will validate the fields.
      //
      // It is reasonable to assume that the first thing we want to know is WHERE we are going to fly from,
      // hence we don't need any other fields to validate the departure.
      requires: [],
      // `influencedBy` introduces "optional dependencies":
      // If we know the arrival, we can narrow the scope of possible departures.
      // But if we don't, we can still offer some options.
      influencedBy: ['arrival'],
      description: 'City of departure',
      // This is the core of our logic.
      // Arguments:
      // - `value`: either departure string if provided, or `undefined` if the user did not pass it.
      // - `context`: an object with the fields that are already known to the LLM.
      //   - `arrival`: the city of arrival, if known. We put it in influencedBy, hence it is an optional argument.
      //
      // The type-level machinery provides us some static checks.
      // Try making `arrival` argument non-optional below, and notice the type error.
      validate: async (value: string | undefined, context: { arrival?: string }) => {
        // We have a convenience utility to give us available flights for given filters.
        const filter: FlightFilters = context;
        const availableFlights = schedule.getAvailableFlights(filter);
        // We compute all available options for the field value.
        const allowedValues = uniq(availableFlights.map(e => e.departure));
        if (allowedValues.some(departure => departure === value)) {
          // If the value matches one of the options, it is VALID.
          return { allowedValues, valid: true };
        }
        // Otherwise, we fail, but provide the options for the LLM to reflect on.
        return { allowedValues, valid: false, refusalReasons: ['no matching options'] };
      },
    })
    .field('arrival', {
      requires: ['departure'],
      influencedBy: ['date'],
      description: 'City of arrival',
      validate: async (
        value: string | undefined,
        // Here, we have `departure` as a requirement, hence we will only start validating this field's value once we have a valid departure.
        context: { departure: string; date?: string },
      ) => {
        const filter: FlightFilters = context;
        const availableFlights = schedule.getAvailableFlights(filter);
        const allowedValues = uniq(availableFlights.map(e => e.arrival));
        if (allowedValues.some(arrival => arrival === value)) {
          return { allowedValues, valid: true, normalizedValue: value };
        }
        return { allowedValues, valid: false, refusalReasons: ['no matching options'] };
      },
    })
    .field('date', {
      requires: ['departure', 'arrival'],
      influencedBy: ['passengers'],
      description: 'Date of departure',
      validate: async (
        value: string | undefined,
        context: { departure: string; arrival: string; passengers?: number },
      ) => {
        const filter: FlightFilters = context;
        const availableFlights = schedule.getAvailableFlights(filter).filter(
          // we can filter out flights that do not have enough seats for the given number of passengers.
          e => e.seats >= (context.passengers ?? 0),
        );
        const allowedValues = uniq(availableFlights.map(e => e.date));
        if (allowedValues.some(date => date === value)) {
          return { allowedValues, valid: true };
        }
        return { allowedValues, valid: false, refusalReasons: ['no matching options'] };
      },
    })
    .field('passengers', {
      requires: ['departure', 'arrival', 'date'],
      influencedBy: [],
      description: 'Number of passengers',
      validate: async (
        value: number | undefined,
        context: { departure: string; arrival: string; date: string },
      ) => {
        const filter: FlightFilters = context;
        const availableFlights = schedule.getAvailableFlights(filter);
        // There are multiple flights available, so we need to check if NONE of them have that number of seats.
        const max = Math.max(0, ...availableFlights.map(e => e.seats));
        if (typeof value !== 'undefined') {
          if (value > max) {
            return {
              valid: false,
              refusalReasons: [`not enough seats available (${value} passengers, max is ${max})`],
            };
          } else {
            return { valid: true as const };
          }
        }
        return { valid: false as const, refusalReasons: ['value required'] };
      },
    })
    // Finally, we call build() that ensures we have provided specs for all dynamic fields.
    .build();

  return tool;
};
