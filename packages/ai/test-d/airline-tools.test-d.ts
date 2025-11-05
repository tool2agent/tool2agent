import z from 'zod';
import { generateText, tool } from 'ai';
import { toolBuilder } from '../src/index.js';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { type ParameterValidationResult, type ToolCallResult } from '@tool2agent/types';

import 'dotenv/config';

// This type is used as fully validated input for the tool's execute function
export const airlineBookingSchema = z.object({
  departure: z.string().min(1),
  arrival: z.string().min(1),
  date: z.string().min(1),
  passengers: z.number().min(1),
});
type AirlineBookingSchema = typeof airlineBookingSchema;
type AirlineBooking = z.infer<AirlineBookingSchema>;

const bookingInputSchema = airlineBookingSchema.partial();
type BookingInputSchema = typeof bookingInputSchema;
type BookingInput = z.infer<BookingInputSchema>;

const dynamic = ['passengers', 'date', 'arrival', 'departure'] as const;

const tool1 = toolBuilder({
  inputSchema: airlineBookingSchema,
  outputSchema: airlineBookingSchema,
  dynamicFields: dynamic,
  description: 'Validate and compute options for airline booking parameters.',
  execute: async (
    input: AirlineBooking,
  ): Promise<ToolCallResult<AirlineBooking, AirlineBooking>> => {
    return { ok: true, ...input };
  },
})
  .field('departure', {
    // @ts-expect-error nonexistent field is not allowed, even as option
    requires: ['nonexistent'],
    description: 'City of departure',
    validate: async (
      value: string | undefined,
      context: { arrival?: string; date?: string; passengers?: number },
    ) => {
      return {} as unknown as ParameterValidationResult<AirlineBooking, 'departure'>;
    },
  })
  .field('arrival', {
    requires: ['departure'],
    description: 'City of arrival',
    // @ts-expect-error value must be string | undefined
    validate: async (
      value: null | undefined,
      context: { departure: string; date?: string; passengers?: number },
    ) => {
      return {} as unknown as ParameterValidationResult<AirlineBooking, 'arrival'>;
    },
  })
  .field('date', {
    requires: ['departure'],
    description: 'Date of departure',
    // @ts-expect-error arrival is not in required list
    validate: async (
      value: string | undefined,
      context: { departure: string; arrival: string; passengers?: number },
    ) => {
      return {} as unknown as ParameterValidationResult<AirlineBooking, 'date'>;
    },
  });

// @ts-expect-error build is not available, missing `passengers` field
const buildCheckedTool1 = tool1.build();

const bookFlight = tool<BookingInput, ToolCallResult<BookingInput, AirlineBooking>>(
  tool1
    .field('passengers', {
      requires: ['departure', 'arrival', 'date'],
      description: 'Number of passengers',
      validate: async (
        value: number | undefined,
        context: { departure: string; arrival: string; date: string },
      ) => {
        return {} as unknown as ParameterValidationResult<AirlineBooking, 'passengers'>;
      },
    })
    .build(),
);

// text completion with tools using ai sdk:
// this will fail obviously, because we muted critical errors
// this is just for type checking
const _ = generateText({
  model: createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! })('openai/gpt-5'),
  tools: { bookFlight },
  toolChoice: 'auto',
  stopWhen: ({ steps }) => steps.length > 5,
  prompt: `Book a flight from London to New York for 2 passengers on 2026 October 2nd if you can. Do not choose closest options. Only exactly matching is allowed.
   use tools. try calling tools until you get a successful tool response.
   If you get a rejection, pay attention to the response validation and rejection reasons and retry.
   `,
});
