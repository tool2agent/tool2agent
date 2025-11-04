import { validateToolSpec, type ToolSpec } from '../src/index.js';

// The purpose of this file is to assert compile-time types only (no runtime).

type Airline = {
  departure: string;
  arrival: string;
  date: string;
  passengers: number;
};

// Valid spec should type-check
const validSpec = {
  departure: {
    requires: [],
    validate: async (
      value: unknown,
      context: { arrival?: string; date?: string; passengers?: number },
    ) => ({
      allowedValues: ['London', 'Berlin'],
      valid: true,
      normalizedValue: 'London',
    }),
  },
  arrival: {
    requires: ['departure'],
    validate: async (
      value: unknown,
      context: { departure: string; date?: string; passengers?: number },
    ) => ({
      allowedValues: ['New York'],
      valid: true,
      normalizedValue: 'New York',
    }),
  },
  date: {
    requires: ['departure', 'arrival'],
    validate: async (
      value: unknown,
      context: { departure: string; arrival: string; passengers?: number },
    ) => ({ allowedValues: ['2026-10-01'], valid: true, normalizedValue: '2026-10-01' }),
  },
  passengers: {
    requires: ['departure', 'arrival', 'date'],
    validate: async (
      value: unknown,
      context: { departure: string; arrival: string; date: string },
    ) => ({ allowedValues: [1, 2, 3], valid: true, normalizedValue: 1 }),
  },
} satisfies ToolSpec<Pick<Airline, 'departure' | 'arrival' | 'date' | 'passengers'>>;
validateToolSpec(validSpec);

// Invalid: reference missing field in requires
const badRequires: ToolSpec<Pick<Airline, 'departure' | 'arrival' | 'date' | 'passengers'>> = {
  departure: {
    // @ts-expect-error - nonexistent field in requires
    requires: ['nonexistent'],
    validate: async () => ({
      allowedValues: ['London'],
      valid: true,
      normalizedValue: 'London',
    }),
  },
  arrival: {
    requires: [],
    validate: async () => ({
      allowedValues: ['New York'],
      valid: true,
      normalizedValue: 'New York',
    }),
  },
  date: {
    requires: [],
    validate: async () => ({
      allowedValues: ['2026-10-01'],
      valid: true,
      normalizedValue: '2026-10-01',
    }),
  },
  passengers: {
    requires: [],
    validate: async () => ({ allowedValues: [1], valid: true, normalizedValue: 1 }),
  },
};

// Invalid: context param types must match requires
const badFetchTypes = {
  departure: {
    requires: [],
    // @ts-expect-error - arrival should be string | undefined; wrong type provided
    validate: async (value: unknown, context: { arrival?: number }) => ({
      allowedValues: ['London'],
      valid: true,
      normalizedValue: 'London',
    }),
  },
  arrival: {
    requires: [],
    validate: async () => ({
      allowedValues: ['New York'],
      valid: true,
      normalizedValue: 'New York',
    }),
  },
  date: {
    requires: [],
    validate: async () => ({
      allowedValues: ['2026-10-01'],
      valid: true,
      normalizedValue: '2026-10-01',
    }),
  },
  passengers: {
    requires: [],
    validate: async () => ({ allowedValues: [1], valid: true, normalizedValue: 1 }),
  },
} satisfies ToolSpec<Pick<Airline, 'departure' | 'arrival' | 'date' | 'passengers'>>;
