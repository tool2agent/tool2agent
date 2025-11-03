import {
  type Tool,
  ToolCallOptions,
  ToolExecuteFunction,
  tool,
  dynamicTool,
} from '@ai-sdk/provider-utils';
import { z } from 'zod';
import type { ToolCallResult } from '@tool2agent/types';

/**
 * Tool2Agent is a type that represents a tool that can be used by an LLM.
 * It is a wrapper around the Tool type from the AI SDK, but the tool call
 * result is a ToolCallResult type (`ok: true | false` + structured feedback).
 */
export type Tool2Agent<InputType, OutputType> = Tool<
  InputType,
  ToolCallResult<InputType, OutputType>
> & {
  // Make execute mandatory
  execute: ToolExecuteFunction<InputType, ToolCallResult<InputType, OutputType>>;
};

/**
 * Parameters for tool2agent() function.
 * - inputSchema: the schema of the input type lifted to the type level
 * - outputSchema: the schema of the output type (can be `typeof z.never()`)
 * - execute: the function that will be called when all the parameters are provided and validated.
 */
export type Tool2AgentParams<
  InputSchema extends z.ZodObject<any>,
  OutputSchema extends z.ZodType<any> = z.ZodNever,
> = {
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  execute: (
    params: z.infer<InputSchema>,
    options?: ToolCallOptions,
  ) =>
    | Promise<ToolCallResult<z.infer<InputSchema>, z.infer<OutputSchema>>>
    | ToolCallResult<z.infer<InputSchema>, z.infer<OutputSchema>>;
};

/**
 * Wrapper over tool() function from AI SDK that enriches it with feedback.
 * @param params - parameters for the tool2agent() function
 * @returns a Tool2Agent type that can be used by an LLM
 * @example
 * const tool = tool2agent({
 *   inputSchema: z.object({ name: z.string() }),
 *   outputSchema: z.object({ greeting: z.string() }),
 *   execute: async (params) => {
 *     return { ok: true, value: { greeting: `Hello, ${params.name}!` } };
 *   },
 * });
 */
export function tool2agent<
  InputSchema extends z.ZodObject<any>,
  OutputSchema extends z.ZodType<any> = z.ZodNever,
>(
  params: Omit<
    Tool<z.infer<InputSchema>, z.infer<OutputSchema>>,
    'execute' | 'inputSchema' | 'outputSchema' | 'toModelOutput'
  > &
    Tool2AgentParams<InputSchema, OutputSchema>,
): Tool2Agent<z.infer<InputSchema>, z.infer<OutputSchema>> {
  const { execute, inputSchema, outputSchema, type, ...rest } = params;
  type InputType = z.infer<InputSchema>;
  type OutputType = z.infer<OutputSchema>;

  const executeFunction = async (
    input: InputType,
    options: ToolCallOptions,
  ): Promise<ToolCallResult<InputType, OutputType>> => {
    // format exception into tool2agent rejection reason
    const handleError = (error: unknown) => {
      const errorMessage = `Exception occured during tool call execution: `;
      if (error instanceof Error) {
        if (error.message && error.name) {
          return {
            ok: false,
            problems: [errorMessage + error.name + ': ' + error.message],
          };
        }
        return {
          ok: false,
          problems: [errorMessage + error.stack],
        };
      }
      return {
        ok: false,
        problems: [errorMessage + String(error)],
      };
    };

    try {
      return (await execute(input, options)) as ToolCallResult<InputType, OutputType>;
    } catch (error: unknown) {
      return handleError(error) as ToolCallResult<InputType, OutputType>;
    }
  };

  // We have to branch on the presence of type: 'function' to let the typechecker
  // catch up with us
  if (type === 'function') {
    const theTool: Tool<InputType, ToolCallResult<InputType, OutputType>> = {
      ...rest,
      type: 'function' as const,
      inputSchema: inputSchema as any,
      execute: executeFunction,
      // hack: make the typechecker happy.
      // We don't need toModelOutput because it is assumed that the output is JSON-serializable.
      toModelOutput: undefined,
      onInputAvailable: undefined,
    };
    // tool() is an identity function but we call it anyway for the love of the game
    return tool(theTool) as Tool2Agent<InputType, OutputType>;
  } else {
    const definition = dynamicTool({
      ...rest,
      inputSchema: inputSchema as any,
      execute: executeFunction as ToolExecuteFunction<unknown, unknown>,
      // hack: make the typechecker happy.
      // We don't need toModelOutput because it is assumed that the output is JSON-serializable.
      toModelOutput: undefined,
    });
    // hack: patch type: dynamic back to the original type
    definition.type = type as any;
    return definition as unknown as Tool2Agent<InputType, OutputType>;
  }
}
