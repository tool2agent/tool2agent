import { type Expect, type Equal } from './expect.js';
import { type Tool2Agent, type Tool2AgentOptions, tool2agent } from '../src/index.js';
import type {
  ToolCallResult,
  ToolCallAccepted,
  ToolCallRejected,
  ToolInputType,
} from '@tool2agent/types';
import { z } from 'zod';

// The purpose of this file is to assert compile-time types only (no runtime).

// ==================== Test Input Type ====================
const testInputSchema = z.object({
  name: z.string(),
});

type TestInputType = z.infer<typeof testInputSchema>;

const outputSchema = z.never();
type OutputType = z.infer<typeof outputSchema>;

// ==================== Test: OutputType = never should not allow value field ====================

// Invalid: When outputSchema is omitted (defaults to never), providing value field should fail
const toolWithNeverOutput = tool2agent({
  type: 'function',
  description: 'Tool with never output type',
  inputSchema: testInputSchema,
  outputSchema: z.never(),
  // @ts-expect-error - value field should be omitted
  execute: async (params: Partial<TestInputType>) => {
    return {
      ok: true,
      value: { something: 'invalid' },
    };
  },
});

const toolWithNeverOutput2 = tool2agent<typeof testInputSchema, typeof outputSchema>({
  type: 'function',
  description: 'Tool with never output type',
  inputSchema: testInputSchema,
  outputSchema: z.never(),
  // @ts-expect-error - value field should be omitted
  execute: async (params: Partial<TestInputType>) => {
    return {
      ok: true,
      value: { something: 'invalid' },
    };
  },
});

const toolWithNeverOutput3 = tool2agent<typeof testInputSchema>({
  type: 'function',
  description: 'Tool with never output type',
  inputSchema: testInputSchema,
  outputSchema: z.never(),
  // @ts-expect-error - value field should be omitted
  execute: async (params: Partial<TestInputType>) => {
    return {
      ok: true,
      value: { something: 'invalid' },
    };
  },
});

// ==================== Test: execute is always present on Tool2Agent ====================

// Create a tool to test with
const testTool = tool2agent({
  type: 'function',
  description: 'Test tool',
  inputSchema: testInputSchema,
  outputSchema: z.never(),
  execute: async (params: Partial<TestInputType>) => {
    return { ok: true as const };
  },
});

// Type-level test: execute should always be present and non-undefined
type TestExecutePresence = Expect<
  Equal<
    Tool2Agent<TestInputType & ToolInputType, OutputType>['execute'],
    NonNullable<Tool2Agent<TestInputType & ToolInputType, OutputType>['execute']>
  >
>;

// Type-level test: execute should be a key of Tool2Agent
type TestExecuteKey = Expect<
  Equal<
    'execute' extends keyof Tool2Agent<TestInputType & ToolInputType, OutputType> ? true : false,
    true
  >
>;

// Type-level test: execute should not be optional
type TestExecuteRequired = Expect<
  Equal<
    undefined extends Tool2Agent<TestInputType & ToolInputType, OutputType>['execute']
      ? false
      : true,
    true
  >
>;

// Runtime test: verify execute exists at runtime
const _testExecuteExists: typeof testTool.execute = testTool.execute;
