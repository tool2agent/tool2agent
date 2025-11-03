import { expect } from 'chai';
import { describe, it } from 'mocha';
import { validate, type ToolSpec, type ToolCallRejected } from '../src/validation.js';
import { toposortFields } from '../src/graph.js';
import { HiddenSpecSymbol } from '../src/builder.js';
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

const spec = (
  tool as unknown as {
    [HiddenSpecSymbol]: ToolSpec<Pick<Airline, 'departure' | 'arrival' | 'date' | 'passengers'>>;
  }
)[HiddenSpecSymbol];
const dynamicFields: (keyof Airline)[] = ['departure', 'arrival', 'date', 'passengers'];

describe('validation.unit.test.ts', () => {
  it('#1 validate rejects when fields are missing and provides allowedValues', async () => {
    const res = await validate(spec, {});
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
    const res = await validate(spec, { departure: 'London', arrival: 'Tokyo' });
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
    const res = await validate(spec, {
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
    const res = await validate(spec, {
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
    const res = await validate(spec, { departure: 'Paris', passengers: 1000 });
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
});
