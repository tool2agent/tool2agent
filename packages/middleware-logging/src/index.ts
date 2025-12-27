import { createMiddleware, type Middleware, type Tool2Agent } from '@tool2agent/ai';
import type { ToolCallResult } from '@tool2agent/types';
import type { ToolCallOptions } from '@ai-sdk/provider-utils';

/**
 * Log entry for a tool call, containing input, output, and timing information.
 *
 * @template InputType - The input type of the tool
 * @template OutputType - The output type of the tool
 */
export interface LogEntry<InputType, OutputType> {
  /**
   * The input that was passed to the tool.
   */
  input: InputType;
  /**
   * The result returned by the tool execution.
   */
  result: ToolCallResult<InputType, OutputType>;
  /**
   * The tool call options passed to the execute function.
   */
  options: ToolCallOptions;
  /**
   * The duration of the tool call execution in milliseconds.
   */
  durationMs: number;
  /**
   * The timestamp when the tool call started.
   */
  startedAt: Date;
  /**
   * The timestamp when the tool call completed.
   */
  completedAt: Date;
}

/**
 * Logger function type that receives log entries for tool calls.
 *
 * @template InputType - The input type of the tool
 * @template OutputType - The output type of the tool
 */
export type Logger<InputType, OutputType> = (
  entry: LogEntry<InputType, OutputType>,
) => void | Promise<void>;

/**
 * Options for configuring the logging middleware.
 *
 * @template InputType - The input type of the tool
 * @template OutputType - The output type of the tool
 */
export interface LoggingOptions<InputType, OutputType> {
  /**
   * The logger function that will be called with log entries for each tool call.
   * This is a required option - you must provide a logger function.
   *
   * @example
   * ```ts
   * logger: (entry) => console.log(`Tool call completed in ${entry.durationMs}ms`, entry)
   * ```
   */
  logger: Logger<InputType, OutputType>;
}

/**
 * Creates a middleware that logs tool call inputs, outputs, and timing information.
 *
 * @param options - Configuration for the logging middleware
 * @returns A middleware that can be applied to a Tool2Agent
 *
 * @example
 * ```ts
 * import { logging } from '@tool2agent/middleware-logging';
 * import { tool2agent } from '@tool2agent/ai';
 *
 * const tool = tool2agent<InputType, OutputType>({
 *   inputSchema,
 *   outputSchema,
 *   execute: async (input) => ({ ok: true, result: `Processed: ${input.query}` }),
 * });
 *
 * // With console logging
 * const loggedTool = logging<InputType, OutputType>({
 *   logger: (entry) => console.log('Tool call:', entry),
 * }).applyTo(tool);
 * ```
 *
 * @example
 * ```ts
 * // With custom logging (e.g., to a file or external service)
 * const loggedTool = logging<InputType, OutputType>({
 *   logger: async (entry) => {
 *     await saveToDatabase({
 *       toolCallId: entry.options.toolCallId,
 *       input: entry.input,
 *       success: entry.result.ok,
 *       durationMs: entry.durationMs,
 *       timestamp: entry.startedAt,
 *     });
 *   },
 * }).applyTo(tool);
 * ```
 *
 * @example
 * ```ts
 * // Composing with other middleware
 * import { idempotency } from '@tool2agent/middleware-idempotency';
 *
 * const tool = logging<InputType, OutputType>({
 *   logger: (entry) => console.log(entry),
 * }).pipe(
 *   idempotency<InputType, OutputType>()
 * ).applyTo(baseTool);
 * ```
 */
export function logging<InputType, OutputType>(
  options: LoggingOptions<InputType, OutputType>,
): Middleware<InputType, OutputType> {
  const { logger } = options;

  return createMiddleware<InputType, OutputType>({
    transform: (tool: Tool2Agent<InputType, OutputType>): Tool2Agent<InputType, OutputType> => {
      const { execute } = tool;

      return {
        ...tool,
        execute: async (
          input: InputType,
          options: ToolCallOptions,
        ): Promise<ToolCallResult<InputType, OutputType>> => {
          const startedAt = new Date();
          const startTime = performance.now();

          const result = await execute(input, options);

          const endTime = performance.now();
          const completedAt = new Date();
          const durationMs = endTime - startTime;

          const logEntry: LogEntry<InputType, OutputType> = {
            input,
            result,
            options,
            durationMs,
            startedAt,
            completedAt,
          };

          await logger(logEntry);

          return result;
        },
      };
    },
  });
}
