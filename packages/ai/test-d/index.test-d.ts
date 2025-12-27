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

// ==================== Test: InputType can diverge from InputSchema ====================
// This is useful for middleware that extends inputs with additional context

// Define the base input schema (what the LLM generates)
const baseInputSchema = z.object({
  query: z.string(),
});

// Define an extended input type (what middleware adds)
type ExtendedInput = z.infer<typeof baseInputSchema> & {
  middlewareContext: {
    userId: string;
    requestId: string;
  };
};

// Test that tool2agent allows InputType to diverge from z.infer<InputSchema>
const toolWithExtendedInput = tool2agent<
  typeof baseInputSchema,
  typeof outputSchema,
  ExtendedInput
>({
  description: 'Tool with extended input type',
  inputSchema: baseInputSchema,
  outputSchema: z.never(),
  execute: async (params: ExtendedInput) => {
    // Verify that both base input and middleware context are accessible
    const _query: string = params.query;
    const _userId: string = params.middlewareContext.userId;
    const _requestId: string = params.middlewareContext.requestId;
    return { ok: true as const };
  },
});

// Type-level test: verify the tool has the correct extended input type
type TestExtendedInputType = Expect<
  Equal<Parameters<typeof toolWithExtendedInput.execute>[0], ExtendedInput>
>;

// Type-level test: verify the inputSchema is typed with ExtendedInput
// (The tool's inputSchema type follows the InputType generic param)
type TestInputSchemaType = Expect<
  Equal<z.infer<typeof toolWithExtendedInput.inputSchema>, ExtendedInput>
>;
