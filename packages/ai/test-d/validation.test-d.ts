import { validateToolSpec, type ToolSpec } from '../src/validation.js';

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
    influencedBy: ['arrival'],
    validate: async (value: unknown, context: { arrival?: string }) => ({
      allowedValues: ['London', 'Berlin'],
      valid: true,
      normalizedValue: 'London',
    }),
  },
  arrival: {
    requires: ['departure'],
    influencedBy: ['date'],
    validate: async (value: unknown, context: { departure: string; date?: string }) => ({
      allowedValues: ['New York'],
      valid: true,
      normalizedValue: 'New York',
    }),
  },
  date: {
    requires: ['departure', 'arrival'],
    influencedBy: ['passengers'],
    validate: async (
      value: unknown,
      context: { departure: string; arrival: string; passengers?: number },
    ) => ({ allowedValues: ['2026-10-01'], valid: true, normalizedValue: '2026-10-01' }),
  },
  passengers: {
    requires: ['departure', 'arrival', 'date'],
    influencedBy: [],
    validate: async (
      value: unknown,
      context: { departure: string; arrival: string; date: string },
    ) => ({ allowedValues: [1, 2, 3], valid: true, normalizedValue: 1 }),
  },
} satisfies ToolSpec<Airline>;
validateToolSpec(validSpec);

// Invalid: reference missing field in requires
const badRequires: ToolSpec<Airline> = {
  departure: {
    // @ts-expect-error - nonexistent field in requires
    requires: ['nonexistent'],
    influencedBy: [],
    validate: async () => ({
      allowedValues: ['London'],
      valid: true,
      normalizedValue: 'London',
    }),
  },
  arrival: {
    requires: [],
    influencedBy: [],
    validate: async () => ({
      allowedValues: ['New York'],
      valid: true,
      normalizedValue: 'New York',
    }),
  },
  date: {
    requires: [],
    influencedBy: [],
    validate: async () => ({
      allowedValues: ['2026-10-01'],
      valid: true,
      normalizedValue: '2026-10-01',
    }),
  },
  passengers: {
    requires: [],
    influencedBy: [],
    validate: async () => ({ allowedValues: [1], valid: true, normalizedValue: 1 }),
  },
};

// Invalid: fetchOptions param types must match requires/influencedBy
const badFetchTypes = {
  departure: {
    requires: [],
    influencedBy: ['arrival'],
    // @ts-expect-error - arrival should be string | undefined; wrong type provided
    validate: async (value: unknown, context: { arrival?: number }) => ({
      allowedValues: ['London'],
      valid: true,
      normalizedValue: 'London',
    }),
  },
  arrival: {
    requires: [],
    influencedBy: [],
    validate: async () => ({
      allowedValues: ['New York'],
      valid: true,
      normalizedValue: 'New York',
    }),
  },
  date: {
    requires: [],
    influencedBy: [],
    validate: async () => ({
      allowedValues: ['2026-10-01'],
      valid: true,
      normalizedValue: '2026-10-01',
    }),
  },
  passengers: {
    requires: [],
    influencedBy: [],
    validate: async () => ({ allowedValues: [1], valid: true, normalizedValue: 1 }),
  },
} satisfies ToolSpec<Airline>;

// Invalid: influencedBy references a non-existing field
const badInfluences = {
  departure: {
    requires: [],
    // @ts-expect-error - non-existing field in influencedBy
    influencedBy: ['ghost'],
    validate: async () => ({
      allowedValues: ['London'],
      valid: true,
      normalizedValue: 'London',
    }),
  },
  arrival: {
    requires: [],
    influencedBy: [],
    validate: async () => ({
      allowedValues: ['New York'],
      valid: true,
      normalizedValue: 'New York',
    }),
  },
  date: {
    requires: [],
    influencedBy: [],
    validate: async () => ({
      allowedValues: ['2026-10-01'],
      valid: true,
      normalizedValue: '2026-10-01',
    }),
  },
  passengers: {
    requires: [],
    influencedBy: [],
    validate: async () => ({ allowedValues: [1], valid: true, normalizedValue: 1 }),
  },
} satisfies ToolSpec<Airline>;
