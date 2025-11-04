import 'dotenv/config';
import * as readline from 'readline';
import { z } from 'zod';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { tool2agent, createMiddleware, type Tool2Agent } from '../src/index.js';
import type { ToolCallResult } from '@tool2agent/types';
import type { ToolCallOptions } from '@ai-sdk/provider-utils';
import { mkAirlineBookingTool, type AirlineBooking } from '../test/airline.js';
import { setLoggingEnabled } from '../src/internal-logger.js';

// Flight data
const flights = [
  { departure: 'london', arrival: 'New York', date: '2026-10-01', seats: 100 },
  { departure: 'london', arrival: 'NEW_YORK', date: '2026-10-02', seats: 2 },
  { departure: 'Berlin', arrival: 'New York', date: '2026-10-03', seats: 2 },
  { departure: 'Berlin', arrival: 'London', date: '2026-10-04', seats: 2 },
  { departure: 'Paris', arrival: 'Tokyo', date: '2026-10-05', seats: 50 },
  { departure: 'New York', arrival: 'Los Angeles', date: '2026-10-06', seats: 25 },
];

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Helper function to ask user for input with timeout
function askUserQuestion(question: string, timeoutMs: number = 120000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout: No response received within 2 minutes'));
    }, timeoutMs);

    rl.question(question + ' ', answer => {
      clearTimeout(timeout);
      resolve(answer.trim());
    });
  });
}

// Create askUser tool
const askUserTool = tool2agent({
  inputSchema: z.object({
    question: z.string().describe('The question to ask the user'),
  }),
  outputSchema: z.object({
    answer: z.string().describe("The user's response"),
  }),
  description:
    'Ask the user a question and wait for their response. Use this when you need clarification or additional information from the user.',
  execute: async (input): Promise<ToolCallResult<{ question: string }, { answer: string }>> => {
    try {
      if (!input.question) {
        return {
          ok: false,
          problems: ['Question is required'],
        };
      }
      const answer = await askUserQuestion(input.question);
      return {
        ok: true,
        answer,
      };
    } catch (error) {
      return {
        ok: false,
        problems: [error instanceof Error ? error.message : 'Failed to get user input'],
      };
    }
  },
});

// Create logging middleware for airline booking tool
const bookingLoggingMiddleware = createMiddleware<AirlineBooking, AirlineBooking>({
  transform: (
    tool: Tool2Agent<AirlineBooking, AirlineBooking>,
  ): Tool2Agent<AirlineBooking, AirlineBooking> => {
    const originalExecute = tool.execute;
    return {
      ...tool,
      execute: async (input: AirlineBooking, options: ToolCallOptions) => {
        console.log(`\n🔧 bookFlight INPUT:`, JSON.stringify(input, null, 2));
        const result = await originalExecute(input, options);
        console.log(`🔧 bookFlight OUTPUT:`, JSON.stringify(result, null, 2));
        return result;
      },
    } as Tool2Agent<AirlineBooking, AirlineBooking>;
  },
});

// Create bookFlight tool using the existing mkAirlineBookingTool function
// Note: mkAirlineBookingTool creates an internal AbortController, but we'll handle it properly
const bookFlightTool = bookingLoggingMiddleware.applyTo(
  mkAirlineBookingTool(flights, async (input: AirlineBooking) => {
    console.log(`\n✓ Flight booked successfully!`);
    console.log(`  Departure: ${input.departure}`);
    console.log(`  Arrival: ${input.arrival}`);
    console.log(`  Date: ${input.date}`);
    console.log(`  Passengers: ${input.passengers}\n`);
    return input;
  }) as Tool2Agent<AirlineBooking, AirlineBooking>,
);

bookFlightTool.description =
  '[tool2agent] Airline booking tool. Use this to book a flight. You must call it even with only part of the information available, it will provide helpful feedback.';

async function main() {
  try {
    console.log('Welcome to the Airline Booking CLI!\n');
    console.log('Please describe your flight booking needs.\n');

    // Get user's initial request
    const userRequest = await askUserQuestion('Your booking request: ');

    if (!userRequest) {
      console.log('No request provided. Exiting.');
      rl.close();
      return;
    }

    const result = await generateText({
      model: createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! })('openai/gpt-5'),
      tools: {
        askUser: askUserTool,
        bookFlight: bookFlightTool,
      },
      toolChoice: 'auto',
      prompt: `You are a helpful airline booking assistant. The user wants to book a flight. Here is their request:

"${userRequest}"

Please help them book a flight by:
1. Using the askUser tool if you need clarification on any missing information (departure city, arrival city, date, number of passengers)
2. Using the bookFlight tool to validate user's partial request. 

You must call it even with only part of the information available, it will provide helpful feedback.
DO NOT provide filler values to tool parameters.
If you don't know a value for field X, you MUST omit the field rather than fill it
Do not provide booking info to the tool until the user has provided it to you explicitly.
Do not ask for double confirmation - if the user said something, it is true.
YOU MUST retry a bookFlight call if its feedback allows you to progress.
The tool responses will give you options for choice. These options should shape your conversation with the user.

Be helpful and guide the user through the booking process. If validation fails, ask the user for corrected information using the askUser tool.

Important: You must complete the booking in a single conversation. Do not ask multiple questions at once - ask one question at a time using askUser, wait for the response, then proceed.`,
      // Limit steps to prevent infinite loops
      stopWhen: ({ steps }) => steps.length > 20,
    });

    if (result.text) {
      console.log('\n' + result.text);
    }
  } catch (error) {
    // Handle abort errors gracefully (these are expected when booking completes)
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.log('\n✓ Booking completed successfully!');
    } else {
      console.error('\nError:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message);
        if (error.stack) {
          console.error('Stack:', error.stack);
        }
      }
    }
  } finally {
    rl.close();
  }
}

// Enable internal logging for debugging airline booking validation
setLoggingEnabled(true);

main().catch(error => {
  console.error('Fatal error:', error);
  rl.close();
});
