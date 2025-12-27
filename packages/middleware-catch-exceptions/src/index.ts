import { createMiddleware, type Middleware, type Tool2Agent } from '@tool2agent/ai';
import type { ToolCallResult, ToolCallFailure, NonEmptyArray } from '@tool2agent/types';
import type { ToolCallOptions } from '@ai-sdk/provider-utils';

/**
 * Options for configuring the exception catching middleware.
 *
 * @template InputType - The input type of the tool
 */
export interface CatchExceptionsOptions<InputType> {
  /**
   * Custom formatter for the problem messages when an exception is caught.
   * @param error - The caught exception
   * @param input - The input that caused the exception
   * @returns The problem messages
   */
  formatProblems?: (error: unknown, input: InputType) => NonEmptyArray<string>;
  /**
   * Custom formatter for the instruction messages when an exception is caught.
   * @param error - The caught exception
   * @param input - The input that caused the exception
   * @returns The instruction messages, or undefined if no instructions should be added
   */
  formatInstructions?: (error: unknown, input: InputType) => NonEmptyArray<string> | undefined;
  /**
   * Optional callback for when an exception is caught.
   * Exceptions thrown by this callback are ignored.
   * @param error - The caught exception
   * @param input - The input that caused the exception
   */
  onException?: (error: unknown, input: InputType) => void | Promise<void>;
}

/**
 * Default formatter for exception problem messages.
 * Handles Error objects with stack traces, name/message, and toString() fallback.
 * Also handles non-Error exceptions using JSON.stringify with String() fallback.
 *
 * @param error - The caught exception
 * @returns The formatted problem message
 */
function defaultFormatProblems(error: unknown): NonEmptyArray<string> {
  const errorMessage = `Exception occured during tool call execution: `;
  if (error instanceof Error) {
    if (error.stack) {
      return [errorMessage + error.stack];
    }
    if (error.message && error.name) {
      return [errorMessage + error.name + ': ' + error.message];
    }
    return [errorMessage + error.toString()];
  }
  // Try JSON.stringify for non-Error exceptions
  try {
    const jsonString = JSON.stringify(error);
    if (jsonString !== undefined) {
      return [errorMessage + jsonString];
    }
  } catch {
    // Fall through to String() fallback
  }
  // Fall back to String() if JSON.stringify fails or returns undefined
  return [errorMessage + String(error)];
}

/**
 * Converts an error to a ToolCallFailure response.
 *
 * @template InputType - The input type of the tool
 * @param error - The caught exception
 * @param input - The input that caused the exception
 * @param options - The middleware options
 * @returns A ToolCallFailure response
 */
function errorToToolCallFailure<InputType>(
  error: unknown,
  input: InputType,
  options: CatchExceptionsOptions<InputType>,
): ToolCallFailure<InputType> {
  const { formatProblems = defaultFormatProblems, formatInstructions } = options;
  const problems = formatProblems(error, input);
  const instructions = formatInstructions?.(error, input);

  if (instructions) {
    return {
      ok: false,
      problems,
      instructions,
    } as ToolCallFailure<InputType>;
  }

  return {
    ok: false,
    problems,
  } as ToolCallFailure<InputType>;
}

/**
 * Creates a middleware that catches exceptions during tool execution and converts them
 * to structured ToolCallFailure responses with formatted error messages.
 *
 * This middleware replaces the `catchExceptions` flag in `tool2agent()` and provides
 * more flexibility through customizable formatters and callbacks.
 *
 * @param options - Optional configuration for the exception catching middleware
 * @returns A middleware that can be applied to a Tool2Agent
 *
 * @example
 * ```ts
 * import { catchExceptions } from '@tool2agent/middleware-catch-exceptions';
 * import { tool2agent } from '@tool2agent/ai';
 *
 * const tool = tool2agent({
 *   inputSchema,
 *   outputSchema,
 *   execute: async (input) => {
 *     // This might throw an exception
 *     const result = await riskyOperation(input);
 *     return { ok: true, result };
 *   },
 * });
 *
 * // Apply the middleware to catch and format exceptions
 * const safeTool = catchExceptions().applyTo(tool);
 * ```
 *
 * @example
 * ```ts
 * // With custom options
 * const safeTool = catchExceptions({
 *   formatProblems: (error, input) => [`Failed to process ${input.name}: ${error}`],
 *   formatInstructions: () => ['Please check your input and try again.'],
 *   onException: (error, input) => console.error('Tool execution failed:', error),
 * }).applyTo(tool);
 * ```
 */
export function catchExceptions<InputType, OutputType>(
  options?: CatchExceptionsOptions<InputType>,
): Middleware<InputType, OutputType> {
  const resolvedOptions = options ?? {};

  return createMiddleware<InputType, OutputType>({
    transform: (tool: Tool2Agent<InputType, OutputType>): Tool2Agent<InputType, OutputType> => {
      const { execute } = tool;

      return {
        ...tool,
        execute: async (
          input: InputType,
          toolCallOptions: ToolCallOptions,
        ): Promise<ToolCallResult<InputType, OutputType>> => {
          try {
            return await execute(input, toolCallOptions);
          } catch (error: unknown) {
            if (resolvedOptions.onException) {
              try {
                await resolvedOptions.onException(error, input);
              } catch {
                // Ignore exceptions from the callback
              }
            }
            return errorToToolCallFailure<InputType>(error, input, resolvedOptions);
          }
        },
      };
    },
  });
}
