import { expect } from 'chai';
import { describe, it } from 'mocha';
import { tool2agent, createMiddleware } from '../src/index.js';
import type { ToolCallOptions } from '@ai-sdk/provider-utils';
import { z } from 'zod';
import type { ToolCallResult } from '@tool2agent/types';

const inputSchema = z.object({ value: z.number() });
const outputSchema = z.object({ result: z.number() });

type InputType = z.infer<typeof inputSchema>;
type OutputType = z.infer<typeof outputSchema>;

// Define base tool factory
const createBaseTool = () =>
  tool2agent({
    inputSchema,
    outputSchema,
    execute: async (params: Partial<InputType>) => {
      return { ok: true as const, result: params.value ?? 0 };
    },
  });

// Middleware 1: adds 1
const add1Middleware = createMiddleware<InputType, OutputType>({
  transform: tool => {
    const originalExecute = tool.execute;
    return {
      ...tool,
      execute: async (input: InputType, options: ToolCallOptions) => {
        const result = (await originalExecute(input, options)) as ToolCallResult<
          InputType,
          OutputType
        >;
        if (result.ok) {
          return { ...result, result: result.result + 1 };
        }
        return result;
      },
    };
  },
});

// Middleware 2: multiplies by 2
const multiply2Middleware = createMiddleware<InputType, OutputType>({
  transform: tool => {
    const originalExecute = tool.execute;
    return {
      ...tool,
      execute: async (input: InputType, options: ToolCallOptions) => {
        const result = (await originalExecute(input, options)) as ToolCallResult<
          InputType,
          OutputType
        >;
        if (result.ok) {
          return { ...result, result: result.result * 2 };
        }
        return result;
      },
    };
  },
});

// Middleware 3: adds 10
const add10Middleware = createMiddleware<InputType, OutputType>({
  transform: tool => {
    const originalExecute = tool.execute;
    return {
      ...tool,
      execute: async (input: InputType, options: ToolCallOptions) => {
        const result = (await originalExecute(input, options)) as ToolCallResult<
          InputType,
          OutputType
        >;
        if (result.ok) {
          return { ...result, result: result.result + 10 };
        }
        return result;
      },
    };
  },
});

// Middleware 4: subtracts 5
const subtract5Middleware = createMiddleware<InputType, OutputType>({
  transform: tool => {
    const originalExecute = tool.execute;
    return {
      ...tool,
      execute: async (input: InputType, options: ToolCallOptions) => {
        const result = (await originalExecute(input, options)) as ToolCallResult<
          InputType,
          OutputType
        >;
        if (result.ok) {
          return { ...result, result: result.result - 5 };
        }
        return result;
      },
    };
  },
});

describe('middleware pipe chaining', () => {
  it('chains 2 middlewares correctly', async () => {
    const baseTool = createBaseTool();
    // Chain: baseTool returns 5, then +1 = 6, then *2 = 12
    const chainedTool = add1Middleware.pipe(multiply2Middleware).applyTo(baseTool);
    const result = await chainedTool.execute({ value: 5 }, { toolCallId: 'test', messages: [] });

    expect(result).to.deep.equal({ ok: true, result: 12 });
  });

  it('chains 3 middlewares correctly', async () => {
    const baseTool = createBaseTool();
    // Chain: baseTool returns 5, then +1 = 6, then *2 = 12, then +10 = 22
    const chainedTool = add1Middleware
      .pipe(multiply2Middleware)
      .pipe(add10Middleware)
      .applyTo(baseTool);
    const result = await chainedTool.execute({ value: 5 }, { toolCallId: 'test', messages: [] });

    expect(result).to.deep.equal({ ok: true, result: 22 });
  });

  it('chains 4 middlewares correctly', async () => {
    const baseTool = createBaseTool();
    // Chain: baseTool returns 5, then +1 = 6, then *2 = 12, then +10 = 22, then -5 = 17
    const chainedTool = add1Middleware
      .pipe(multiply2Middleware)
      .pipe(add10Middleware)
      .pipe(subtract5Middleware)
      .applyTo(baseTool);
    const result = await chainedTool.execute({ value: 5 }, { toolCallId: 'test', messages: [] });

    expect(result).to.deep.equal({ ok: true, result: 17 });
  });
});
