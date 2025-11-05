import { z } from 'zod';
import type { ToolCallResult } from '@tool2agent/types';

/**
 * Converts an output schema to a ToolCallResult schema.
 * Creates a simplified ToolCallResult schema without AtLeastOne/AtMostOne constraints.
 */
export function createToolCallResultSchema<InputType, OutputType>(
  inputSchema: z.ZodType<InputType>,
  outputSchema: z.ZodType<OutputType>,
): z.ZodType<ToolCallResult<InputType, OutputType>> {
  // Common feedback fields
  const feedbackFields = {
    feedback: z.array(z.string()).optional(),
    instructions: z.array(z.string()).optional(),
  };

  // Success case: { ok: true, ...outputFields, feedback?, instructions? }
  // If OutputType is a record, spread it directly; otherwise wrap in value
  const successSchema = (() => {
    const baseSuccess = z.object({
      ok: z.literal(true),
      ...feedbackFields,
    });

    // Check if outputSchema is an object schema
    if (outputSchema instanceof z.ZodObject) {
      // For object schemas, merge the output fields directly
      return baseSuccess.merge(outputSchema);
    } else {
      // For non-object schemas, wrap in value field
      return baseSuccess.extend({
        value: outputSchema,
      });
    }
  })();

  // ParameterValidationResult schema (simplified, without AtLeastOne/AtMostOne)
  // Matches: CommonFailureFeedback<T> & (valid: true | (valid: false & ParameterValidationFailureReasons))
  const parameterValidationResultSchema = z.object({
    valid: z.boolean(),
    // CommonFailureFeedback fields
    normalizedValue: z.unknown().optional(),
    dynamicParameterSchema: z.unknown().optional(),
    allowedValues: z.array(z.unknown()).optional(),
    suggestedValues: z.array(z.unknown()).optional(),
    feedback: z.array(z.string()).optional(),
    instructions: z.array(z.string()).optional(),
    // ParameterValidationFailureReasons fields (only present when valid: false)
    problems: z.array(z.string()).optional(),
    requiresValidParameters: z.array(z.string()).optional(),
  });

  // Check if InputType is a record (object) by checking if inputSchema is a ZodObject
  const isRecordInput = inputSchema instanceof z.ZodObject;

  // Failure case structure depends on whether InputType is a record
  // For records: RecordFailureFeedback = AtLeastOne<{ problems, validationResults? }>
  //   - validationResults contains ParameterValidationResult which has CommonFailureFeedback
  //   - RecordFailureFeedback itself does NOT have CommonFailureFeedback at top level
  // For non-records: ValueFailureFeedback = { problems } & CommonFailureFeedback<InputType>
  //   - ValueFailureFeedback has CommonFailureFeedback fields directly
  const failureSchema = isRecordInput
    ? z.object({
        ok: z.literal(false),
        problems: z.array(z.string()).optional(),
        ...feedbackFields,
        // validationResults maps parameter names to ParameterValidationResult objects
        // Only present for record inputs (RecordFailureFeedback)
        // AtLeastOne constraint simplified: both optional (at least one should be present in practice)
        validationResults: z.record(z.string(), parameterValidationResultSchema).optional(),
      })
    : z.object({
        ok: z.literal(false),
        problems: z.array(z.string()),
        ...feedbackFields,
        // For non-record inputs (ValueFailureFeedback), include CommonFailureFeedback fields directly
        // No validationResults for non-record inputs
        normalizedValue: z.unknown().optional(),
        dynamicParameterSchema: z.unknown().optional(),
        allowedValues: z.array(z.unknown()).optional(),
        suggestedValues: z.array(z.unknown()).optional(),
      });

  // Union of success and failure
  return z.discriminatedUnion('ok', [successSchema, failureSchema]) as z.ZodType<
    ToolCallResult<InputType, OutputType>
  >;
}
