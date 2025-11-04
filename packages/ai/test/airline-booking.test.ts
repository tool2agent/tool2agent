import { expect } from 'chai';
import { describe, it } from 'mocha';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import 'dotenv/config';
import { type AirlineBooking, mkAirlineBookingTool } from './airline.js';
import { setLoggingEnabled } from '../src/internal/logger.js';

setLoggingEnabled(true);

describe('airline-booking.test.ts', () => {
  it('#1 executes and returns accepted value', async function () {
    this.timeout(100000);

    // Our dataset.
    // We introduce some syntactic noise to demonstrate that the tool is able to handle it.
    const flights = [
      { departure: 'london', arrival: 'New York', date: '2026-10-01', seats: 100 },
      // THE correct booking that we need:
      { departure: 'london', arrival: 'NEW_YORK', date: '2026-10-02', seats: 2 },
      { departure: 'Berlin', arrival: 'New York', date: '2026-10-03', seats: 2 },
      { departure: 'Berlin', arrival: 'London', date: '2026-10-04', seats: 2 },
      { departure: 'Paris', arrival: 'Tokyo', date: '2026-10-05', seats: 50 },
      { departure: 'New York', arrival: 'Los Angeles', date: '2026-10-06', seats: 25 },
    ];

    let executeCalledWith: AirlineBooking | null = null;
    const responseReceivedController = new AbortController();
    try {
      const tool = mkAirlineBookingTool(flights, async input => {
        executeCalledWith = input;
        responseReceivedController.abort();
        return input;
      });

      const _result = await generateText({
        model: createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! })('openai/gpt-5'),
        // We plug our tool here:
        tools: { bookFlight: tool },
        toolChoice: 'auto',
        abortSignal: responseReceivedController.signal,
        // Limit the number of steps to 5 to avoid long loops.
        stopWhen: ({ steps }) => steps.length > 5,
        prompt: `Book a flight from London to New York for two passengers on 2026 October 2nd if you can.
  Do not choose closest options. Only exact SEMANTIC matching is allowed.
  Use tools. try calling tools until you get a successful tool response.
  If you get a rejection, pay attention to the response validation and rejection reasons and retry.
    `,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // expected, we aborted the LLM inference
      } else {
        throw error;
      }
    }

    // The flight that we wanted to book
    const expectedFlight: AirlineBooking = {
      departure: 'london',
      arrival: 'NEW_YORK',
      date: '2026-10-02',
      passengers: 2,
    };
    expect(executeCalledWith).to.deep.equal(expectedFlight);
  });
});
