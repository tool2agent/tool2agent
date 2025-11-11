import { createMiddleware, type Middleware, type Tool2Agent } from '@tool2agent/ai';
import type { ToolCallResult, NonEmptyArray } from '@tool2agent/types';
import type { ToolCallOptions } from '@ai-sdk/provider-utils';
import hash from 'object-hash';

/**
 * Interface for a set-like data structure that can store input values.
 *
 * @template InputType - The input type of the tool
 */
export interface IdempotencySet<InputType> {
  /**
   * Check if the input has been seen before.
   * @param input - The input to check
   * @returns true if the input has been seen, false otherwise
   */
  has(input: InputType): boolean | Promise<boolean>;
  /**
   * Add the input to the set.
   * @param input - The input to add
   */
  add(input: InputType): void | Promise<void>;
}

/**
 * Default implementation of IdempotencySet using object-hash and a Set.
 *
 * @template InputType - The input type of the tool
 */
class DefaultIdempotencySet<InputType> implements IdempotencySet<InputType> {
  private readonly hashes = new Set<string>();

  has(input: InputType): boolean {
    const payloadHash = hash(input as unknown as Record<string, unknown>);
    return this.hashes.has(payloadHash);
  }

  add(input: InputType): void {
    const payloadHash = hash(input as unknown as Record<string, unknown>);
    this.hashes.add(payloadHash);
  }
}

/**
 * Options for configuring the idempotency middleware.
 *
 * @template InputType - The input type of the tool
 */
export interface IdempotencyOptions<InputType> {
  /**
   * Custom formatter for the problem messages when a duplicate call is detected.
   * @param input - The duplicate input
   * @returns The problem messages
   */
  formatProblems?: (input: InputType) => NonEmptyArray<string>;
  /**
   * Custom formatter for the instruction messages when a duplicate call is detected.
   * @param input - The duplicate input
   * @returns The instruction messages
   */
  formatInstructions?: (input: InputType) => NonEmptyArray<string>;
  /**
   * Custom set implementation for tracking seen inputs.
   * If not provided, uses a default implementation with object-hash and Set.
   */
  set?: IdempotencySet<InputType>;
  /**
   * Optional logging callback for when duplicate calls are detected.
   * Exceptions are passed through.
   * @param input - The duplicate input
   */
  onDuplicate?: (input: InputType) => void | Promise<void>;
}

/**
 * Creates a middleware that ensures idempotency by preventing duplicate tool calls with the same input.
 *
 * @param options - Optional configuration for the idempotency middleware
 * @returns A middleware that can be applied to a Tool2Agent
 *
 * @example
 * ```ts
 * import { idempotency } from '@tool2agent/middleware-idempotency';
 * import { tool2agent } from '@tool2agent/ai';
 *
 * const tool = tool2agent<InputType, OutputType>({
 *   inputSchema,
 *   outputSchema,
 *   execute: async (input) => ({ ok: true, result: `Processed: ${input.query}` }),
 * });
 * const idempotentTool = idempotency<InputType, OutputType>().applyTo(tool);
 * ```
 *
 * @example
 * ```ts
 * // With custom options
 * const idempotentTool = idempotency({
 *   formatProblems: (input) => [`Duplicate call detected for query: ${input.query}`],
 *   formatInstructions: () => ['This tool call was already executed. Please avoid duplicate calls.'],
 *   onDuplicate: (input) => console.log('Duplicate detected:', input),
 * }).applyTo(tool);
 * ```
 */
export function idempotency<InputType, OutputType>(
  options?: IdempotencyOptions<InputType>,
): Middleware<InputType, OutputType> {
  const {
    formatProblems = (_input: InputType): NonEmptyArray<string> => [
      'Tool call processing skipped: the tool has been called with this payload already.',
    ],
    formatInstructions = (): NonEmptyArray<string> => [
      'This tool is idempotent. Avoid issuing duplicate tool calls in the future.',
    ],
    set = new DefaultIdempotencySet<InputType>(),
    onDuplicate,
  } = options ?? {};

  return createMiddleware<InputType, OutputType>({
    transform: (tool: Tool2Agent<InputType, OutputType>): Tool2Agent<InputType, OutputType> => {
      const { execute } = tool;

      return {
        ...tool,
        execute: async (
          input: InputType,
          options: ToolCallOptions,
        ): Promise<ToolCallResult<InputType, OutputType>> => {
          if (await set.has(input)) {
            if (onDuplicate) {
              await onDuplicate(input);
            }
            return {
              ok: false,
              problems: formatProblems(input),
              instructions: formatInstructions(input),
            };
          }

          await set.add(input);
          return await execute(input, options);
        },
      };
    },
  });
}
