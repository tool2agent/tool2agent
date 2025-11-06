import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
  type ToolSpec,
  type ToolCallRejected,
  type ToolFieldConfig,
} from '../src/index.js';
import { getToolBuilderSpec } from '../src/builder/builder.js';
import { validateToolInput } from '../src/builder/validation.js';
import { toposortFields } from '../src/builder/graph.js';
import { mkAirlineBookingTool } from './airline.js';

type Airline = {
  departure: string;
  arrival: string;
  date: string;
  passengers: number;
};

const entries = [
  { departure: 'London', arrival: 'New York', date: '2026-10-01', seats: 100 },
  { departure: 'London', arrival: 'New York', date: '2026-10-02', seats: 1 },
  { departure: 'Berlin', arrival: 'New York', date: '2026-10-03', seats: 2 },
  { departure: 'Berlin', arrival: 'London', date: '2026-10-04', seats: 2 },
  { departure: 'Paris', arrival: 'Tokyo', date: '2026-10-05', seats: 50 },
  { departure: 'New York', arrival: 'Los Angeles', date: '2026-10-06', seats: 25 },
];

const uniq = <T>(xs: T[]) => Array.from(new Set(xs));

const tool = mkAirlineBookingTool(entries, async input => {
  return input;
});

const spec = getToolBuilderSpec<Pick<Airline, 'departure' | 'arrival' | 'date' | 'passengers'>>(tool)!;

describe('validation.unit.test.ts', () => {
  it('#1 validate rejects when fields are missing and provides allowedValues', async () => {
    const res = await validateToolInput(spec, {});
    const expected: ToolCallRejected<Airline> = {
      status: 'rejected',
      validationResults: {
        departure: {
          valid: false,
          problems: ['no matching options'],
          allowedValues: ['London', 'Berlin', 'Paris', 'New York'],
        },
        arrival: { valid: false, requiresValidParameters: ['departure'] },
        date: { valid: false, requiresValidParameters: ['departure', 'arrival'] },
        passengers: { valid: false, requiresValidParameters: ['departure', 'arrival', 'date'] },
      },
    };
    expect(res).to.deep.equal(expected);
  });

  it('#2 rejects invalid dependent value with filtered allowedValues (arrival given departure)', async () => {
    const res = await validateToolInput(spec, { departure: 'London', arrival: 'Tokyo' });
    console.log(JSON.stringify(toposortFields(spec), null, 2));
    const expected: ToolCallRejected<Airline> = {
      status: 'rejected',
      validationResults: {
        departure: { valid: true, allowedValues: ['London', 'Berlin', 'Paris', 'New York'] },
        arrival: {
          valid: false,
          allowedValues: ['New York'],
          problems: ['no matching options'],
        },
        date: { valid: false, requiresValidParameters: ['arrival'] },
        passengers: { valid: false, requiresValidParameters: ['arrival', 'date'] },
      },
    };
    expect(res).to.deep.equal(expected);
  });

  it('#3 rejects with allowed options when date invalid and passengers too large for available seats', async () => {
    const res = await validateToolInput(spec, {
      departure: 'London',
      arrival: 'New York',
      date: '2026-10-02',
      passengers: 5,
    });
    const expected = {
      status: 'rejected' as const,
      validationResults: {
        departure: { valid: true, allowedValues: ['London', 'Berlin', 'Paris', 'New York'] },
        arrival: { valid: true, allowedValues: ['New York'] },
        date: { valid: true, allowedValues: ['2026-10-01', '2026-10-02'] },
        passengers: {
          valid: false,
          problems: ['not enough seats available (5 passengers, max is 1)'],
        },
      },
    };
    expect(res).to.deep.equal(expected);
  });

  it('#4 accepts a valid full selection', async () => {
    const res = await validateToolInput(spec, {
      departure: 'Berlin',
      arrival: 'London',
      date: '2026-10-04',
      passengers: 2,
    });
    const expected = {
      status: 'accepted' as const,
      value: { departure: 'Berlin', arrival: 'London', date: '2026-10-04', passengers: 2 },
    };
    expect(res).to.deep.equal(expected);
  });

  it('#5 options are always included even when rejected', async () => {
    const res = await validateToolInput(spec, { departure: 'Paris', passengers: 1000 });
    const expected = {
      status: 'rejected' as const,
      validationResults: {
        departure: { valid: true, allowedValues: ['London', 'Berlin', 'Paris', 'New York'] },
        arrival: {
          valid: false,
          allowedValues: ['Tokyo'],
          problems: ['no matching options'],
        },
        date: { valid: false, requiresValidParameters: ['arrival'] },
        passengers: { valid: false, requiresValidParameters: ['arrival', 'date'] },
      },
    };
    expect(res).to.deep.equal(expected);
  });

  it('#6 normalization: normalizedValue different from input is included in result', async () => {
    // Create a spec with normalization that changes the value
    type NormalizedInput = {
      name: string;
    };
    const normalizationSpec: ToolSpec<Pick<NormalizedInput, 'name'>> = {
      name: {
        requires: [],
        validate: async (value: string | undefined) => {
          if (value === '  john  ') {
            // Normalize: trim and capitalize
            return {
              valid: true,
              normalizedValue: 'John',
            };
          }
          return { valid: false, problems: ['invalid format'] };
        },
      },
    };

    const res = await validateToolInput(normalizationSpec, { name: '  john  ' });

    const expected = {
      status: 'accepted' as const,
      value: { name: 'John' }, // Should use normalized value
    };
    expect(res).to.deep.equal(expected);
  });

  it('#7 normalization: normalizedValue equal to input is removed from result', async () => {
    // Create a spec with normalization that returns same value (no-op normalization)
    type NormalizedInput = {
      name: string;
    };
    const normalizationSpec: ToolSpec<Pick<NormalizedInput, 'name'>> = {
      name: {
        requires: [],
        validate: async (value: string | undefined) => {
          if (value === 'John') {
            // Return normalizedValue equal to input (no-op)
            return {
              valid: true,
              normalizedValue: 'John', // Same as input
            };
          }
          return { valid: false, problems: ['invalid format'] };
        },
      },
    };

    const res = await validateToolInput(normalizationSpec, { name: 'John' });

    const expected = {
      status: 'accepted' as const,
      value: { name: 'John' },
    };
    expect(res).to.deep.equal(expected);
  });

  it('#8 normalization: normalizedValue in validation result when different', async () => {
    type NormalizedInput = {
      name: string;
    };
    const normalizationSpec: ToolSpec<Pick<NormalizedInput, 'name'>> = {
      name: {
        requires: [],
        validate: async (value: string | undefined) => {
          if (value === 'lowercase') {
            return {
              valid: true,
              normalizedValue: 'LOWERCASE',
            };
          }
          return { valid: false, problems: ['invalid'] };
        },
      },
    };

    const res = await validateToolInput(normalizationSpec, { name: 'lowercase' });

    const expected = {
      status: 'accepted' as const,
      value: { name: 'LOWERCASE' }, // Should use normalized value
    };
    expect(res).to.deep.equal(expected);
  });

  it('#9 normalization: invalid field with normalizedValue does not add to validFields', async () => {
    type NormalizedInput = {
      name: string;
      age: number;
    };
    const normalizationSpec: ToolSpec<Pick<NormalizedInput, 'name' | 'age'>> = {
      name: {
        requires: [],
        validate: async (value: string | undefined) => {
          // Invalid field but returns normalizedValue anyway
          return {
            valid: false,
            problems: ['invalid'],
            normalizedValue: 'Normalized', // Should not be used since valid: false
          };
        },
      },
      age: {
        requires: ['name'],
        validate: async () => ({ valid: true }),
      },
    };

    const res = await validateToolInput(normalizationSpec, { name: 'test', age: 25 });

    const expected = {
      status: 'rejected' as const,
      validationResults: {
        name: {
          valid: false,
          problems: ['invalid'],
          normalizedValue: 'Normalized', // normalizedValue is still in validation result
        },
        age: {
          valid: false,
          requiresValidParameters: ['name'],
        },
      },
    };
    expect(res).to.deep.equal(expected);
  });

  it('#10 static fields: initialized immediately and available in context', async () => {
    type MixedInput = {
      staticField: string; // Static field
      dynamicField: string; // Dynamic field
    };
    // Create ToolFieldConfig with full InputType and proper StaticFields typing
    // StaticFields = Exclude<keyof MixedInput, 'dynamicField' | 'dynamicField'> = 'staticField'
    // ContextFor<MixedInput, 'dynamicField', readonly [], 'staticField'> evaluates to:
    // Pick<MixedInput, never> & Pick<MixedInput, 'staticField'> & Partial<Pick<MixedInput, never>>
    // = {} & { staticField: string } & {} = { staticField: string }
    const dynamicFieldConfig: ToolFieldConfig<
      MixedInput,
      'dynamicField',
      readonly [],
      'staticField'
    > = {
      requires: [],
      validate: async (value: string | undefined, context: { staticField: string }) => {
        // Verify static field is available in context at runtime
        expect(context.staticField).to.equal('static-value');
        if (value === 'dynamic-value') {
          return { valid: true };
        }
        return { valid: false, problems: ['invalid'] };
      },
    };
    // Construct spec - ToolSpec<Pick<...>> expects configs typed with Pick<...>,
    // but at runtime validateToolInput uses the full InputType with static fields.
    // We use the same pattern as builder.ts: assign the correctly typed config
    // and let TypeScript handle the structural compatibility.
    const mixedSpec: ToolSpec<Pick<MixedInput, 'dynamicField'>> = {
      dynamicField: {
        requires: dynamicFieldConfig.requires,
        validate: dynamicFieldConfig.validate as ToolFieldConfig<
          Pick<MixedInput, 'dynamicField'>,
          'dynamicField'
        >['validate'],
      },
    };

    const res = await validateToolInput<MixedInput, 'dynamicField'>(mixedSpec, {
      staticField: 'static-value', // Static field
      dynamicField: 'dynamic-value', // Dynamic field
    });

    const expected = {
      status: 'accepted' as const,
      value: {
        staticField: 'static-value',
        dynamicField: 'dynamic-value',
      },
    };
    expect(res).to.deep.equal(expected);
  });

  it('#11 static fields: only static fields in input', async () => {
    type MixedInput = {
      staticField: string;
      dynamicField: string;
    };
    const mixedSpec: ToolSpec<Pick<MixedInput, 'dynamicField'>> = {
      dynamicField: {
        requires: [],
        validate: async () => ({ valid: true }),
      },
    };

    const res = await validateToolInput(mixedSpec, {
      staticField: 'static-only',
      // dynamicField not provided
    });

    const expected = {
      status: 'accepted' as const,
      value: {
        staticField: 'static-only',
        dynamicField: undefined, // Not provided, not validated
      },
    };
    expect(res).to.deep.equal(expected);
  });
});
