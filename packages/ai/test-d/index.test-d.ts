import { type Expect, type Equal } from './expect.js';
import { type Tool2Agent, tool2agent } from '../src/index.js';
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

// We should turn it into an error case.
// Currently, the extra field is allowed because TypeScript does not check for extra fields when
// using intersection types (ToolCallSuccess)
const toolWithNeverOutput = tool2agent({
  description: 'Tool with never output type',
  inputSchema: testInputSchema,
  outputSchema: z.never(),
  execute: async (params: TestInputType) => {
    return {
      ok: true,
      something: { something: 'invalid' },
    };
  },
});

// ==================== Test: execute is always present on Tool2Agent ====================

// Create a tool to test with
const testTool = tool2agent({
  description: 'Test tool',
  inputSchema: testInputSchema,
  outputSchema: z.never(),
  execute: async (params: TestInputType) => {
    return { ok: true as const };
  },
});

// Type-level test: execute should always be present and non-undefined
type TestExecutePresence = Expect<
  Equal<
    Tool2Agent<TestInputType, OutputType>['execute'],
    NonNullable<Tool2Agent<TestInputType, OutputType>['execute']>
  >
>;

// Type-level test: execute should be a key of Tool2Agent
type TestExecuteKey = Expect<
  Equal<'execute' extends keyof Tool2Agent<TestInputType, OutputType> ? true : false, true>
>;

// Type-level test: execute should not be optional
type TestExecuteRequired = Expect<
  Equal<undefined extends Tool2Agent<TestInputType, OutputType>['execute'] ? false : true, true>
>;

// Runtime test: verify execute exists at runtime
const _testExecuteExists: typeof testTool.execute = testTool.execute;
