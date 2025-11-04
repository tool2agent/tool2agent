// Re-export all tool2agent types
export type * from '@tool2agent/types';

export { tool2agent, type Tool2AgentParams, type Tool2Agent } from './tool2agent.js';
export {
  toolBuilder,
  type ToolBuilderParams,
  type ToolFieldConfig,
  type BuilderApi,
  type DynamicInputType,
  type DynamicInput,
} from './builder.js';
export { createMiddleware, type Middleware, type MiddlewareOptions } from './middleware.js';
export type { ToolSpec, ToolInputFieldParams as FieldSpec } from './validation.js';
