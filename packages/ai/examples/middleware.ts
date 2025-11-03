import { generateObject } from 'ai';
import { tool2agent, createMiddleware, type Tool2Agent } from '../src/index.js';
import { ToolCallOptions } from '@ai-sdk/provider-utils';
import { z } from 'zod';
import { openrouter } from '@openrouter/ai-sdk-provider';
import type { ToolCallResult } from '@tool2agent/types';
import * as readline from 'node:readline/promises';
import 'dotenv/config';

const inputSchema = z.object({ query: z.string() });
const outputSchema = z.object({ results: z.array(z.string()) });

type SearchToolInput = z.infer<typeof inputSchema>;
type SearchToolOutput = z.infer<typeof outputSchema>;

// Create the base tool
const baseTool = tool2agent({
  description: 'Query something somewhere',
  inputSchema,
  outputSchema,
  execute: async (params: SearchToolInput) => {
    return {
      ok: true,
      results: ['Query reversed: ' + params.query.split('').reverse().join('')],
    } as ToolCallResult<SearchToolInput, SearchToolOutput>;
  },
});

// Forbids "evil" queries from being processed by the tool
// This middleware intercepts the execute call to check for evil queries before execution
const evilFilterMiddleware = createMiddleware<SearchToolInput, SearchToolOutput>({
  transform: tool => {
    const originalExecute = tool.execute;
    return {
      ...tool,
      execute: async (input: SearchToolInput, options: ToolCallOptions) => {
        const query = input.query;
        const isEvil = await generateObject({
          model: openrouter('openai/gpt-4o-mini'),
          schema: z.object({ isEvil: z.boolean() }),
          prompt: `Is the object or notion "${query}" considered evil?`,
        });
        if (isEvil.object.isEvil) {
          return {
            ok: false,
            validationResults: {
              query: {
                valid: false,
                problems: ['the query you provided is evil which is not allowed'],
              },
            },
          } as ToolCallResult<SearchToolInput, SearchToolOutput>;
        }
        const result = await originalExecute(input, options);
        // Handle AsyncIterable case (though Tool2Agent typically returns Promise)
        if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
          return result as unknown as ToolCallResult<SearchToolInput, SearchToolOutput>;
        }
        return result as ToolCallResult<SearchToolInput, SearchToolOutput>;
      },
    } as Tool2Agent<SearchToolInput, SearchToolOutput>;
  },
});

// Prevents secrets from being fed to the LLM
const secrets = ['secret1', 'password1'];

const secretsFilterMiddleware = createMiddleware<SearchToolInput, SearchToolOutput>({
  transform: tool => {
    const originalExecute = tool.execute;
    return {
      ...tool,
      execute: async (input: SearchToolInput, options: ToolCallOptions) => {
        const result = await originalExecute(input, options);
        const typedResult = result as ToolCallResult<SearchToolInput, SearchToolOutput>;
        // If the result is rejected, return it as-is
        if (!typedResult.ok) {
          return typedResult;
        }
        // Check the output for secrets
        const resultString = JSON.stringify(typedResult);
        if (secrets.some(secret => resultString.includes(secret))) {
          return {
            ok: false,
            problems: ['the output contains a secret which is not allowed'],
          };
        }
        return typedResult;
      },
    } as Tool2Agent<SearchToolInput, SearchToolOutput>;
  },
});

// Compose the middlewares and apply to the base tool
const tool = evilFilterMiddleware.pipe(secretsFilterMiddleware).applyTo(baseTool);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log('This example demonstrates how middlewares can be composed together.');
console.log('The tool reverses the string you enter.');
console.log('tool2agent applies the following middlewares:');
console.log(
  "- evilFilterMiddleware: filters out evil queries via llm-powered validation (try 'satan')",
);
console.log(
  '- secretsFilterMiddleware: filters out secrets from the output. Secrets are: ' +
    secrets.join(', ') +
    ' (try entering them in reverse)',
);
console.log('The tool is then executed with the composed middleware.');

while (true) {
  const query = await rl.question('Enter a query: ');
  const result = await tool.execute!({ query }, { toolCallId: crypto.randomUUID(), messages: [] });
  console.log(JSON.stringify(result, null, 2));
}
