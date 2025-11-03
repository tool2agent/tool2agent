import { type Expect, type Equal } from './expect.js';
import {
  mkFeedbackAndInstructionsSchema,
  mkAcceptableValuesSchema,
  mkParameterValidationFailureReasonsSchema,
  mkParameterValidationResultSchema,
  mkValidationResultsSchema,
  mkToolCallSuccessSchema,
  mkToolCallFailureSchema,
  mkToolCallResultSchema,
  mkTool2AgentSchema,
} from '../src/index.js';
import type {
  FeedbackAndInstructions,
  AcceptableValues,
  ParameterValidationFailureReasons,
  ParameterValidationResult,
  ToolCallSuccess,
  ToolCallFailure,
  ToolCallResult,
} from '@tool2agent/types';
import { z } from 'zod';

// The purpose of this file is to assert compile-time types only (no runtime).
// It verifies that z.infer<typeof schema> matches the corresponding TypeScript types.

// ==================== Test Input Schema ====================
const testInputSchema = z.object({
  name: z.string(),
  age: z.number().int(),
  email: z.string().email().optional(),
});

type TestInputType = z.infer<typeof testInputSchema>;

const testOutputSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
});

type TestOutputType = z.infer<typeof testOutputSchema>;

// Create key enum using z.keyof() (Zod v4+)
const paramKeyEnum = z.keyof(testInputSchema);

// ==================== FeedbackAndInstructions Schema Tests ====================
const feedbackAndInstructionsSchema = mkFeedbackAndInstructionsSchema();
type InferredFeedbackAndInstructions = z.infer<typeof feedbackAndInstructionsSchema>;
type _TestFeedbackAndInstructions1 = Expect<
  Equal<InferredFeedbackAndInstructions, FeedbackAndInstructions>
>;

// ==================== AcceptableValues Schema Tests ====================
const acceptableValuesSchema = mkAcceptableValuesSchema(z.string());
type InferredAcceptableValues = z.infer<typeof acceptableValuesSchema>;
type _TestAcceptableValues1 = Expect<Equal<InferredAcceptableValues, AcceptableValues<string>>>;

// ==================== ParameterValidationFailureReasons Schema Tests ====================
const parameterValidationFailureReasonsSchema =
  mkParameterValidationFailureReasonsSchema<TestInputType>(paramKeyEnum);
type InferredParameterValidationFailureReasons = z.infer<
  typeof parameterValidationFailureReasonsSchema
>;
type _TestParameterValidationFailureReasons1 = Expect<
  Equal<
    InferredParameterValidationFailureReasons,
    ParameterValidationFailureReasons<TestInputType, keyof TestInputType>
  >
>;

// ==================== ParameterValidationResult Schema Tests ====================
const parameterValidationResultSchema = mkParameterValidationResultSchema<
  TestInputType,
  string,
  'name'
>(testInputSchema.shape.name, paramKeyEnum);
type InferredParameterValidationResult = z.infer<typeof parameterValidationResultSchema>;
type _TestParameterValidationResult1 = Expect<
  Equal<InferredParameterValidationResult, ParameterValidationResult<TestInputType, 'name'>>
>;

// ==================== ValidationResults Schema Tests ====================
const validationResultsSchema = mkValidationResultsSchema<TestInputType>(
  testInputSchema,
  paramKeyEnum,
);
type InferredValidationResults = z.infer<typeof validationResultsSchema>;
type ExpectedValidationResults = {
  [K in keyof TestInputType & string]?: ParameterValidationResult<TestInputType, K>;
};
type _TestValidationResults1 = Expect<Equal<InferredValidationResults, ExpectedValidationResults>>;

// ==================== ToolCallSuccess Schema Tests ====================
const toolCallSuccessSchema = mkToolCallSuccessSchema<TestOutputType>(testOutputSchema);
type InferredToolCallSuccess = z.infer<typeof toolCallSuccessSchema>;
type _TestToolCallSuccess1 = Expect<
  Equal<InferredToolCallSuccess, ToolCallSuccess<TestOutputType>>
>;

// Test case: when outputSchema is z.never(), value field should be omitted
const toolCallSuccessNeverSchema = mkToolCallSuccessSchema<never>(z.never());
type InferredToolCallSuccessNever = z.infer<typeof toolCallSuccessNeverSchema>;
type _TestToolCallSuccessNever1 = Expect<
  Equal<InferredToolCallSuccessNever, ToolCallSuccess<never>>
>;

// ==================== ToolCallFailure Schema Tests ====================
const toolCallFailureSchema = mkToolCallFailureSchema<TestInputType>(validationResultsSchema);
type InferredToolCallFailure = z.infer<typeof toolCallFailureSchema>;
type _TestToolCallFailure1 = Expect<Equal<InferredToolCallFailure, ToolCallFailure<TestInputType>>>;

// ==================== ToolCallResult Schema Tests ====================
const toolCallResultSchema = mkToolCallResultSchema<TestInputType, TestOutputType>(
  toolCallSuccessSchema,
  toolCallFailureSchema,
);
type InferredToolCallResult = z.infer<typeof toolCallResultSchema>;
type _TestToolCallResult1 = Expect<
  Equal<InferredToolCallResult, ToolCallResult<TestInputType, TestOutputType>>
>;

// ==================== mkTool2AgentSchema Integration Tests ====================
const tool2AgentSchema = mkTool2AgentSchema(testInputSchema, testOutputSchema);
type InferredTool2AgentResult = z.infer<typeof tool2AgentSchema>;
type _TestTool2AgentResult1 = Expect<
  Equal<InferredTool2AgentResult, ToolCallResult<TestInputType, TestOutputType>>
>;

// ==================== Empty Input Schema Tests ====================
const emptyInputSchema = z.object({});
type EmptyInputType = z.infer<typeof emptyInputSchema>;
const emptyTool2AgentSchema = mkTool2AgentSchema(emptyInputSchema, testOutputSchema);
type InferredEmptyTool2AgentResult = z.infer<typeof emptyTool2AgentSchema>;
type _TestEmptyTool2AgentResult1 = Expect<
  Equal<InferredEmptyTool2AgentResult, ToolCallResult<EmptyInputType, TestOutputType>>
>;

// ==================== Non-Record Input Schema Tests ====================
// Test with string input (non-record)
const stringInputSchema = z.string();
type StringInputType = z.infer<typeof stringInputSchema>;
const stringTool2AgentSchema = mkTool2AgentSchema(stringInputSchema, testOutputSchema);
type InferredStringTool2AgentResult = z.infer<typeof stringTool2AgentSchema>;
type _TestStringTool2AgentResult1 = Expect<
  Equal<InferredStringTool2AgentResult, ToolCallResult<StringInputType, TestOutputType>>
>;

// Test with number input (non-record)
const numberInputSchema = z.number();
type NumberInputType = z.infer<typeof numberInputSchema>;
const numberTool2AgentSchema = mkTool2AgentSchema(numberInputSchema, z.never());
type InferredNumberTool2AgentResult = z.infer<typeof numberTool2AgentSchema>;
type _TestNumberTool2AgentResult1 = Expect<
  Equal<InferredNumberTool2AgentResult, ToolCallResult<NumberInputType, never>>
>;

// Test with array input (non-record)
const arrayInputSchema = z.array(z.string());
type ArrayInputType = z.infer<typeof arrayInputSchema>;
const arrayTool2AgentSchema = mkTool2AgentSchema(arrayInputSchema, z.string());
type InferredArrayTool2AgentResult = z.infer<typeof arrayTool2AgentSchema>;
type _TestArrayTool2AgentResult1 = Expect<
  Equal<InferredArrayTool2AgentResult, ToolCallResult<ArrayInputType, string>>
>;

// Test with union input (non-record)
const unionInputSchema = z.union([z.string(), z.number()]);
type UnionInputType = z.infer<typeof unionInputSchema>;
const unionTool2AgentSchema = mkTool2AgentSchema(unionInputSchema, z.boolean());
type InferredUnionTool2AgentResult = z.infer<typeof unionTool2AgentSchema>;
type _TestUnionTool2AgentResult1 = Expect<
  Equal<InferredUnionTool2AgentResult, ToolCallResult<UnionInputType, boolean>>
>;
