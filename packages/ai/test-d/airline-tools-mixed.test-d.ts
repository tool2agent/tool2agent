import z from 'zod';
import { toolBuilder } from '../src/index.js';
import { type ParameterValidationResult, type ToolCallResult } from '@tool2agent/types';

// This type is used as fully validated input for the tool's execute function
export const airlineBookingSchema = z.object({
  departure: z.string().min(1),
  arrival: z.string().min(1),
  date: z.string().min(1),
  passengers: z.number().min(1).optional(),
});
export type AirlineBookingSchema = typeof airlineBookingSchema;
export type AirlineBooking = z.infer<AirlineBookingSchema>;

const dynamic = ['arrival', 'departure'] as const;

const builder = toolBuilder({
  inputSchema: airlineBookingSchema,
  outputSchema: airlineBookingSchema,
  dynamicFields: dynamic,
  description: 'Validate and compute options for airline booking parameters.',
  execute: async (
    input: AirlineBooking,
  ): Promise<ToolCallResult<AirlineBooking, AirlineBooking>> => {
    return { ok: true, ...input };
  },
});

builder.field('departure', {
  requires: [],
  // @ts-expect-error unknown field is not allowed, even as option
  validate: async (value: string | undefined, context: { unknown?: string }) => {
    return {} as any as ParameterValidationResult<AirlineBooking, 'departure'>;
  },
});

builder.field('departure', {
  requires: [],
  // @ts-expect-error type of a static field is wrong
  validate: async (value: string | undefined, context: { date: number }) => {
    return {} as any as ParameterValidationResult<AirlineBooking, 'departure'>;
  },
});

builder.field('departure', {
  requires: [],
  // @ts-expect-error presence of a static field is wrong, must be optional
  validate: async (value: string | undefined, context: { passengers: number }) => {
    return {} as any as ParameterValidationResult<AirlineBooking, 'departure'>;
  },
});

builder.field('departure', {
  // @ts-expect-error date is not a dynamic field, cannot be in requires
  requires: ['date'],
  validate: async (value: string | undefined, context: { passengers?: number }) => {
    return {} as any as ParameterValidationResult<AirlineBooking, 'departure'>;
  },
});

builder
  .field('departure', {
    requires: [],
    description: 'City of departure',
    validate: async (
      value: string | undefined,
      context: { arrival?: string; passengers?: number; date: string },
    ) => {
      return {} as any as ParameterValidationResult<AirlineBooking, 'departure'>;
    },
  })
  // @ts-expect-error build is not available, missing `arrival` field specification
  .build();

const bookFlight = builder
  .field('departure', {
    requires: [],
    description: 'City of departure',
    validate: async (
      value: string | undefined,
      context: { arrival?: string; passengers?: number; date: string },
    ) => {
      return {} as any as ParameterValidationResult<AirlineBooking, 'departure'>;
    },
  })
  .field('arrival', {
    requires: ['departure'],
    description: 'City of arrival',
    validate: async (
      value: string | undefined,
      context: { departure: string; passengers?: number; date: string },
    ) => {
      return {} as any as ParameterValidationResult<AirlineBooking, 'arrival'>;
    },
  })
  .build();
