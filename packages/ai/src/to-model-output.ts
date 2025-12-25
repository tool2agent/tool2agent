import type { ToolCallResult } from '@tool2agent/types';

/**
 * Text output for the language model.
 */
export type ModelOutputText = { type: 'text'; value: string };

/**
 * JSON output for the language model.
 */
export type ModelOutputJson = { type: 'json'; value: unknown };

/**
 * The output type that toModelOutput can return.
 * Supports plain text and JSON only.
 */
export type ModelOutput = ModelOutputText | ModelOutputJson;

/**
 * A function that converts a ToolCallResult to a model output.
 * This is the type signature for the toModelOutput parameter of tool2agent.
 */
export type ToModelOutputFn<InputType, OutputType> = (
  result: ToolCallResult<InputType, OutputType>,
) => ModelOutput;

/**
 * Creates a toModelOutput function that converts ToolCallResult to text format.
 * This is a simple builder for text-based output.
 *
 * @param render - A function that takes the ToolCallResult and returns a string
 * @returns A toModelOutput function compatible with tool2agent
 *
 * @example
 * ```typescript
 * const tool = tool2agent({
 *   inputSchema,
 *   outputSchema,
 *   execute: async (input) => ({ ok: true, result: 'success' }),
 *   toModelOutput: createTextOutput(result => {
 *     if (result.ok) {
 *       return `Result: ${result.result}`;
 *     }
 *     return `Error: ${result.problems?.join(', ')}`;
 *   }),
 * });
 * ```
 */
export function createTextOutput<InputType, OutputType>(
  render: (result: ToolCallResult<InputType, OutputType>) => string,
): ToModelOutputFn<InputType, OutputType> {
  return (result: ToolCallResult<InputType, OutputType>): ModelOutput => ({
    type: 'text',
    value: render(result),
  });
}

/**
 * Creates a toModelOutput function that converts ToolCallResult to JSON format.
 * This is the default behavior if no toModelOutput is provided.
 *
 * @param transform - Optional function to transform the result before JSON serialization
 * @returns A toModelOutput function compatible with tool2agent
 *
 * @example
 * ```typescript
 * const tool = tool2agent({
 *   inputSchema,
 *   outputSchema,
 *   execute: async (input) => ({ ok: true, result: 'success' }),
 *   toModelOutput: createJsonOutput(result => ({
 *     success: result.ok,
 *     data: result.ok ? result : null,
 *   })),
 * });
 * ```
 */
export function createJsonOutput<InputType, OutputType>(
  transform?: (result: ToolCallResult<InputType, OutputType>) => unknown,
): ToModelOutputFn<InputType, OutputType> {
  return (result: ToolCallResult<InputType, OutputType>): ModelOutput => ({
    type: 'json',
    value: transform ? transform(result) : result,
  });
}
