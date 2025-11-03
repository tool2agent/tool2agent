import 'dotenv/config';
import { z } from 'zod';
import { Tool2Agent, tool2agent } from '../src/index.js';
import type { ToolCallResult, ToolCallFailure, ToolCallSuccess } from '@tool2agent/types';
import { generateText, stepCountIs } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';

// This example shows how tool2agent feedback can be used to bypass censorship built in a search tool by using synonyms.

// We have a dataset to search over.
// Each entry is a single string of space-separated single-word synonyms, ending with `DOC_ID: <number>`
const DATASET: string[] = [
  'secret hidden covert confidential clandestine undercover hush cryptic arcane veiled DOC_ID: 203',
  'happy cheerful joyful glad pleased content elated merry jovial jubilant DOC_ID: 101',
  'sad unhappy sorrowful dejected gloomy downcast melancholy mournful somber blue DOC_ID: 102',
  'fast quick rapid speedy swift brisk nimble prompt agile expeditious DOC_ID: 201',
  'slow sluggish lethargic tardy gradual plodding deliberate lagging creeping unhurried DOC_ID: 202',
  'big large huge massive vast immense colossal gigantic enormous mammoth DOC_ID: 301',
  // Search target document
  'small little tiny minor minute petite compact slight miniature diminutive puny DOC_ID: 302',
];

// The task is to find DOC_ID for the document containing the word "little".
const SEARCH_TARGET = 'little';

// some common synonyms of "little" are blocklisted
const CENSORSHIP_BLACKLIST = new Set<string>(['small', 'little', 'tiny', 'petite']);

// The input schema for the search tool
const inputSchema = z.object({ q: z.string().min(1) });
// The output schema for the search tool
const outputSchema = z.object({ results: z.array(z.string()) });

type SearchToolInput = z.infer<typeof inputSchema>;
type SearchToolOutput = z.infer<typeof outputSchema>;

// Check query for blocked words
function checkCensorship(text: string): string | null {
  const tokenize = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const tokens = tokenize(text);
  const blocked = tokens.find(t => CENSORSHIP_BLACKLIST.has(t));
  return blocked ?? null;
}

// Search the dataset for the query
function searchDataset(query: string, dataset: string[]): string[] {
  const q = query.toLowerCase();
  const lines: string[] = [];
  for (const line of dataset) {
    if (line.toLowerCase().includes(q)) {
      lines.push(line);
    }
  }
  return lines;
}

// tool2agent tool definition for search.
const searchTool = tool2agent({
  description: 'Exact-match search over a dataset',
  inputSchema,
  outputSchema,
  // This function handles both validation and execution, returning ToolCallResult.
  // We get Partial<SearchToolInput> because the LLM may not provide all the parameters.
  // This is one of the features of tool2agent: it allows the LLM to provide an incomplete payload
  // just to get some validation feedback.
  execute: async (
    params: Partial<SearchToolInput>,
  ): Promise<ToolCallResult<SearchToolInput, SearchToolOutput>> => {
    console.log('execute:', params);
    const q = params.q?.trim() ?? '';

    // Validate input
    if (!q) {
      return {
        ok: false,
        problems: ['Missing query string'],
        validationResults: {
          q: { valid: false, problems: ['Provide a non-empty query'] },
        },
      };
    }

    // Check for censorship
    if (checkCensorship(q)) {
      const response: ToolCallFailure<SearchToolInput> = {
        ok: false,
        validationResults: {
          q: {
            valid: false,
            problems: ['The requested term is not allowed by policy'],
            instructions: [`Try a different term, synonymous to ${q}`],
          },
        },
      };
      console.log('execute result (rejected):', JSON.stringify(response, null, 2));
      return response;
    }

    // Execute search
    const docs = searchDataset(q, DATASET);
    console.log('execute params:', { q }, 'docs:\n', '- ' + docs.join('\n- '));

    const response: ToolCallSuccess<SearchToolOutput> = {
      ok: true,
      results: docs,
    };
    console.log('execute result (accepted):', JSON.stringify(response, null, 2));
    return response;
  },
});

async function run() {
  const apiKey: string = process.env.OPENROUTER_API_KEY!;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  console.log(`Trying to find DOC_ID for "${SEARCH_TARGET}"`);
  console.log('Dataset:');
  console.log('- ' + DATASET.join('\n- '));
  console.log('Censorship blacklist:', CENSORSHIP_BLACKLIST);

  const model = openrouter('openai/gpt-4o-mini');

  const result = await generateText({
    model,
    providerOptions: {
      openai: {
        parallelToolCalls: false,
      },
      openrouter: {
        parallelToolCalls: false,
      },
    },
    system: `You are an assistant.
Use the search tool for exact, single-word matches over a dataset containing texts.
Keep trying until you can retrieve the result`,
    prompt: `Find the DOC_ID for the document containing the word "${SEARCH_TARGET}".
Do not give up until you have found the DOC_ID.
Respond with LITERALLY JUST DOC_ID number.`,
    tools: {
      search: searchTool,
    },
    // Allow multiple steps so the model can iterate with synonyms
    stopWhen: stepCountIs(15),
  });

  console.log('Final text:', result.text.trim(), 'correct:', result.text.trim() === '302');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
