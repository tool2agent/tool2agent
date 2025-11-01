import type { ToolInputType } from '@tool2agent/types';
import type { Tool2Agent } from './tool2agent.js';

/**
 * Middleware that transforms a Tool2Agent into another Tool2Agent.
 * This allows applying transformations to inputs, outputs, or execute functions.
 *
 * @template InputType - The input type of the original tool
 * @template OutputType - The output type of the original tool
 * @template NewInputType - The input type of the transformed tool (defaults to InputType)
 * @template NewOutputType - The output type of the transformed tool (defaults to OutputType)
 */
export type Middleware<
  InputType extends ToolInputType,
  OutputType,
  NewInputType extends ToolInputType = InputType,
  NewOutputType = OutputType,
> = {
  /**
   * The middleware function that transforms a Tool2Agent.
   */
  applyTo: (tool: Tool2Agent<InputType, OutputType>) => Tool2Agent<NewInputType, NewOutputType>;
  /**
   * Pipe this middleware with another middleware, creating a new middleware that applies both in sequence.
   * The current middleware is applied first, then the next middleware.
   *
   * @param next - The next middleware to apply after this one
   * @returns A new middleware that applies both middlewares in sequence
   *
   * @example
   * ```ts
   * const middleware1 = createMiddleware({ transform: (tool) => ... });
   * const middleware2 = createMiddleware({ transform: (tool) => ... });
   *
   * const composed = middleware1.pipe(middleware2);
   * const finalTool = composed.applyTo(originalTool);
   * ```
   */
  pipe<FinalInputType extends ToolInputType, FinalOutputType>(
    next: Middleware<NewInputType, NewOutputType, FinalInputType, FinalOutputType>,
  ): Middleware<InputType, OutputType, FinalInputType, FinalOutputType>;
};

/**
 * Options for configuring middleware transformations.
 * Uses a single `transform` function that transforms a Tool2Agent into another Tool2Agent,
 * ensuring type alignment between execute function and input schema.
 *
 * @template InputType - The input type of the original tool
 * @template OutputType - The output type of the original tool
 * @template NewInputType - The input type of the transformed tool (defaults to InputType)
 * @template NewOutputType - The output type of the transformed tool (defaults to OutputType)
 */
export type MiddlewareOptions<
  InputType extends ToolInputType,
  OutputType,
  NewInputType extends ToolInputType = InputType,
  NewOutputType = OutputType,
> = {
  /**
   * Transform the tool into a new tool.
   * This method ensures type alignment between the execute function and input schema.
   *
   * @param tool - The original Tool2Agent to transform
   * @returns The transformed Tool2Agent
   */
  transform: (tool: Tool2Agent<InputType, OutputType>) => Tool2Agent<NewInputType, NewOutputType>;
};

/**
 * Internal helper function to create a piped middleware by composing multiple middlewares.
 * This function recursively composes middlewares to support unlimited chaining.
 *
 * @template InputType - The input type of the original tool
 * @template OutputType - The output type of the original tool
 * @template CurrentInputType - The input type after the current middleware chain
 * @template CurrentOutputType - The output type after the current middleware chain
 * @template FinalInputType - The input type after the next middleware
 * @template FinalOutputType - The output type after the next middleware
 */
function createPipe<
  InputType extends ToolInputType,
  OutputType,
  CurrentInputType extends ToolInputType,
  CurrentOutputType,
  FinalInputType extends ToolInputType,
  FinalOutputType,
>(
  currentApplyTo: (
    tool: Tool2Agent<InputType, OutputType>,
  ) => Tool2Agent<CurrentInputType, CurrentOutputType>,
  next: Middleware<CurrentInputType, CurrentOutputType, FinalInputType, FinalOutputType>,
): Middleware<InputType, OutputType, FinalInputType, FinalOutputType> {
  const composedApplyTo = (tool: Tool2Agent<InputType, OutputType>) => {
    return next.applyTo(currentApplyTo(tool));
  };
  return {
    applyTo: composedApplyTo,
    pipe: <FinalFinalInputType extends ToolInputType, FinalFinalOutputType>(
      nextNext: Middleware<
        FinalInputType,
        FinalOutputType,
        FinalFinalInputType,
        FinalFinalOutputType
      >,
    ): Middleware<InputType, OutputType, FinalFinalInputType, FinalFinalOutputType> => {
      return createPipe(composedApplyTo, nextNext);
    },
  };
}

/**
 * Creates a middleware object from middleware options.
 *
 * @param options - Middleware configuration options
 * @returns A middleware object that can be applied to a Tool2Agent
 *
 * @example
 * ```ts
 * const logMiddleware = createMiddleware({
 *   transform: (tool) => {
 *     const originalExecute = tool.execute;
 *     return {
 *       ...tool,
 *       execute: async (input, options) => {
 *         console.log('Input:', input);
 *         const result = await originalExecute(input, options);
 *         console.log('Output:', result);
 *         return result;
 *       },
 *     };
 *   },
 * });
 *
 * const toolWithLogging = logMiddleware.applyTo(originalTool);
 * ```
 */
export function createMiddleware<
  InputType extends ToolInputType,
  OutputType,
  NewInputType extends ToolInputType = InputType,
  NewOutputType = OutputType,
>(
  options: MiddlewareOptions<InputType, OutputType, NewInputType, NewOutputType>,
): Middleware<InputType, OutputType, NewInputType, NewOutputType> {
  const applyTo = (tool: Tool2Agent<InputType, OutputType>) => options.transform(tool);

  return {
    applyTo,
    pipe<FinalInputType extends ToolInputType, FinalOutputType>(
      next: Middleware<NewInputType, NewOutputType, FinalInputType, FinalOutputType>,
    ): Middleware<InputType, OutputType, FinalInputType, FinalOutputType> {
      return createPipe(applyTo, next);
    },
  };
}
