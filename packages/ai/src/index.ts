// Re-export all tool2agent types
export type * from '@tool2agent/types';

export { tool2agent, type Tool2AgentParams, type Tool2Agent } from './tool2agent.js';
export { toolBuilder } from './builder.js';
export {
  type ToolBuilderParams,
  type ToolFieldConfig,
  type BuilderApi,
  type DynamicInputType,
  type DynamicInput,
  type ToolSpec,
  type ToolCallAccepted,
  type ToolCallRejected,
  type ToolCallValidationResult,
  type ContextFor,
  type BuildContextResult,
  type BuilderState,
  HiddenSpecSymbol,
} from './types.js';
export { validateToolSpec, buildContext, validateToolInput } from './validation.js';
export { createMiddleware, type Middleware, type MiddlewareOptions } from './middleware.js';
