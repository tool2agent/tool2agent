import { type ProviderOptions, ToolCallOptions, tool, dynamicTool } from '@ai-sdk/provider-utils';
import { z } from 'zod';
import type { ToolCallResult, ToolCallFailure } from '@tool2agent/types';
import type { NonEmptyArray } from '@tool2agent/types';

/**
 * Tool2Agent is a concrete type that represents a tool that can be used by an LLM.
 * It is compatible with AI SDK's Tool type but:
 * - Only supports type?: 'function' (the default)
 * - Always has inputSchema and outputSchema
 * - execute is mandatory and only returns Promise (not AsyncIterable)
 */
export type Tool2Agent<InputType, OutputType> = {
  /**
   * An optional description of what the tool does.
   * Will be used by the language model to decide whether to use the tool.
   */
  description?: string;
  /**
   * Additional provider-specific metadata. They are passed through
   * to the provider from the AI SDK and enable provider-specific
   * functionality that can be fully encapsulated in the provider.
   */
  providerOptions?: ProviderOptions;
  /**
   * The schema of the input that the tool expects. The language model will use this to generate the input.
   * It is also used to validate the output of the language model.
   */
  inputSchema: z.ZodType<InputType>;
  /**
   * The schema of the output that the tool produces.
   */
  outputSchema: z.ZodType<OutputType>;
  /**
   * Mandatory function that is called with the arguments from the tool call and produces a result.
   * Always returns a Promise (not AsyncIterable).
   */
  execute: (
    input: InputType,
    options: ToolCallOptions,
  ) => Promise<ToolCallResult<InputType, OutputType>>;
  /**
   * Optional function that is called when the argument streaming starts.
   * Only called when the tool is used in a streaming context.
   */
  onInputStart?: (options: ToolCallOptions) => void | PromiseLike<void>;
  /**
   * Optional function that is called when an argument streaming delta is available.
   * Only called when the tool is used in a streaming context.
   */
  onInputDelta?: (
    options: {
      inputTextDelta: string;
    } & ToolCallOptions,
  ) => void | PromiseLike<void>;
  /**
   * Optional function that is called when a tool call can be started,
   * even if the execute function is not provided.
   */
  onInputAvailable?: (
    options: {
      input: InputType;
    } & ToolCallOptions,
  ) => void | PromiseLike<void>;
  /**
   * Optional conversion function that maps the tool result to an output that can be used by the language model.
   * If not provided, the tool result will be sent as a JSON object.
   */
  toModelOutput?: (output: OutputType) => any;
};

/**
 * Parameters for creating a Tool2Agent.
 * @template InputSchema - The Zod schema for the tool's input.
 * @template OutputSchema - The Zod schema for the tool's output.
 */
export type Tool2AgentParams<
  InputSchema extends z.ZodType<any>,
  OutputSchema extends z.ZodType<any>,
> = {
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  execute: (
    input: z.infer<InputSchema>,
    options: ToolCallOptions,
  ) => Promise<ToolCallResult<z.infer<InputSchema>, z.infer<OutputSchema>>>;
  catchExceptions?: boolean;
} & Omit<
  Tool2Agent<z.infer<InputSchema>, z.infer<OutputSchema>>,
  'inputSchema' | 'outputSchema' | 'execute'
>;

/**
 * Wrapper over tool() function from AI SDK that enriches it with feedback.
 * @param params - parameters for the tool2agent() function
 * @param params.execute - function that will be called when the tool is called
 * @param params.inputSchema - the schema of the input type
 * @param params.outputSchema - the schema of the output type (can be `typeof z.never()` if none needed)
 * @param params.catchExceptions - whether to catch exceptions and return them formatted nicely to the LLM as tool2agent `problems`. defaults to true.
 * @returns a Tool2Agent type that can be used by AI SDK tools.
 * @example
 * const tool = tool2agent({
 *   inputSchema: z.object({ name: z.string() }),
 *   outputSchema: z.object({ greeting: z.string() }),
 *   execute: async (params) => {
 *     return { ok: true, value: { greeting: `Hello, ${params.name}!` } };
 *   },
 * });
 */
export function tool2agent<InputSchema extends z.ZodType<any>, OutputSchema extends z.ZodType<any>>(
  params: Tool2AgentParams<InputSchema, OutputSchema>,
): Tool2Agent<z.infer<InputSchema>, z.infer<OutputSchema>> {
  const { execute, inputSchema, outputSchema, ...rest } = params;
  type InputType = z.infer<InputSchema>;
  type OutputType = z.infer<OutputSchema>;

  const executeFunction = async (
    input: InputType,
    options: ToolCallOptions,
  ): Promise<ToolCallResult<InputType, OutputType>> => {
    // format exception into tool2agent rejection reason

    if (typeof params.catchExceptions === 'undefined' || params.catchExceptions) {
      try {
        return (await execute(input, options)) as ToolCallResult<InputType, OutputType>;
      } catch (error: unknown) {
        return errorToToolCallFailure<InputType>(error);
      }
    } else {
      return (await execute(input, options)) as ToolCallResult<InputType, OutputType>;
    }
  };

  const theTool: Tool2Agent<InputType, OutputType> = {
    ...rest,
    inputSchema,
    outputSchema,
    execute: executeFunction,
  };
  // tool() is an identity function but we call it anyway for the love of the game
  return tool(theTool) as Tool2Agent<InputType, OutputType>;
}

function errorToToolCallFailure<InputType>(error: unknown): ToolCallFailure<InputType> {
  const errorMessage = `Exception occured during tool call execution: `;
  if (error instanceof Error) {
    if (error.stack) {
      return {
        ok: false as const,
        problems: [errorMessage + error.stack],
      } as ToolCallFailure<InputType>;
    }
    if (error.message && error.name) {
      return {
        ok: false,
        problems: [errorMessage + error.name + ': ' + error.message],
      } as ToolCallFailure<InputType>;
    }
    return {
      ok: false,
      problems: [errorMessage + error.toString()],
    } as ToolCallFailure<InputType>;
  }
  // Try JSON.stringify for non-Error exceptions
  try {
    const jsonString = JSON.stringify(error);
    if (jsonString !== undefined) {
      return {
        ok: false,
        problems: [errorMessage + jsonString],
      } as ToolCallFailure<InputType>;
    }
  } catch {
    // Fall through to String() fallback
  }
  // Fall back to String() if JSON.stringify fails or returns undefined
  const problems: NonEmptyArray<string> = [errorMessage + String(error)];
  return {
    ok: false,
    problems,
  } as ToolCallFailure<InputType>;
}
