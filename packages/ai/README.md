# @tool2agent/ai [![API docs](https://img.shields.io/badge/API%20docs-blue)](https://tool2agent.org/docs/)

[tool2agent](https://github.com/tool2agent/tool2agent) interface for AI SDK.

```bash
pnpm install @tool2agent/ai
```

```typescript
import { tool2agent, toolBuilder } from '@tool2agent/ai';
```

## Motivation

[tool2agent](https://github.com/tool2agent/tool2agent) is a protocol that enables LLM agents to navigate complex business constraints through trial and error by communicating rich and structured feedback data from tools.

[Read more about tool2agent](https://github.com/tool2agent/tool2agent?tab=readme-ov-file#about)

## About

This package implements tool2agent bindings for AI SDK in two forms:

- `toolBuilder()` - a type-safe mini-framework for creating interactive LLM tools with rich feedback.
- `tool2agent()` - a tool2agent-enabled replacement for AI SDK `tool()` that gives full manual control over validation logic to the developer, providing only type safety.

### Tool builder

`toolBuilder()` is the main value proposition of tool2agent so far. It allows you to semi-declaratively define tool feedback flows.

`toolBuilder()` accepts a tool input schema with some of its fields marked as _dynamic parameters_.

At runtime, dynamic parameters are made optional, and the LLM can fill them as it "sees" fit.

Every dynamic parameter has a validation function attached that is called regardless of whether the parameter has been passed. This allows the tool to provide feedback at any time. For example, feedback can include a list of value suggestions that may depend on _other_ parameter values.

These parameter inter-dependencies are what make `toolBuilder()` a neat instrument for building conversational LLM workflows, because they allow you to specify the _ordering_ of parameters to be filled, which guides the assistant towards _asking the user the right questions_.

[Check out a complete usage example](./test/airline.ts)

### `tool2agent()` function

This interface wires together tool2agent types and AI SDK by translating tool2agent tool parameters to AI SDK `tool()` parameters.

<details>
<summary><strong>Show types</strong></summary>

```typescript
import type { Tool } from 'ai';
import type { ToolCallResult } from '@tool2agent/types';

// This definition is simplified for illustrative purposes
type Tool2Agent<InputType, OutputType> = Tool<
  InputType,
  // output is always a `ToolCallResult` that can be either accepted (with output value),
  // or rejected (with mandatory feedback)
  ToolCallResult<InputType, OutputType>
>;
```

- See [`ToolCallResult` definition](../types/src/tool2agent.ts)
</details>

The `tool2agent()` function allows you to define AI SDK LLM tools using an `execute()` method that handles both validation and execution, returning structured feedback via [`ToolCallResult`](../types/src/tool2agent.ts).

<details>
<summary><strong>How to use <code>tool2agent()</code></strong></summary>

- `execute()` accepts a tool payload and returns a [`ToolCallResult`](../types/src/tool2agent.ts) that can either succeed (`ok: true`) with the output value, or fail (`ok: false`) with structured feedback info.

```typescript
// Parameters of tool2agent() function:
function tool2agent<
  InputSchema extends z.ZodType<any>,
  OutputSchema extends z.ZodType<any>,
>(params: {
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  execute: (
    input: z.infer<InputSchema>,
    options: ToolCallOptions,
  ) => Promise<ToolCallResult<z.infer<InputSchema>, z.infer<OutputSchema>>>;
  // other parameters omitted
}): Tool2Agent<z.infer<InputSchema>, z.infer<OutputSchema>>;
// ^ `Tool2Agent` is compatible with AI SDK `Tool`
```

</details>

<details>
<summary><strong>Differences between <code>tool()</code> and <code>tool2agent()</code></strong></summary>

- AI SDK `tool()` does nothing and exists only for type checking, while `tool2agent()` builds the tool's `execute()` method
- `tool()` passes exceptions through, while `tool2agent()` catches exceptions and returns them formatted nicely to the LLM as tool2agent `problems`
- `tool2agent()` mandates input and output schemas. Use `never` / `z.never()` for output schema if it is not needed.
- `tool2agent()` expects a json-serializable output type, and for this reason, it does not support providing custom `toModelOutput`

</details>

### Middleware

`createMiddleware()` allows you to compose transformations around tools, enabling reusable logic for validation, logging, or input/output transformation. Middleware can be piped together using the `.pipe()` method.

<details>
<summary><strong>Show type definition</strong></summary>

```typescript
export type Middleware<
  InputType,
  OutputType,
  NewInputType = InputType,
  NewOutputType = OutputType,
> = {
  applyTo: (tool: Tool2Agent<InputType, OutputType>) => Tool2Agent<NewInputType, NewOutputType>;
  pipe<FinalInputType, FinalOutputType>(
    next: Middleware<NewInputType, NewOutputType, FinalInputType, FinalOutputType>,
  ): Middleware<InputType, OutputType, FinalInputType, FinalOutputType>;
};
```

</details>

## Examples

- [airline-booking-chat](./examples/airline-booking-chat.ts) - interactive example demonstrating how to use `toolBuilder()` for building conversational agents with logical dependencies between parameters and complex validation logic
- [censorship-bypass](./examples/censorship-bypass.ts) - shows how tool feedback can be used to guide the LLM towards its goal in the presence of an obstacle (word filter for search queries)
- [middleware](./examples/middleware.ts) - demonstrates how middleware can be composed to add validation and execution logic around tool calls
- [agent-consensus](./examples/agent-consensus.ts) - Multiple agents reaching consensus using a knowledge base that keeps track of each other's constraints. tool2agent is used to provide feedback from that knowledge base.

## See also

- [tool2agent type definitions](../types/src/tool2agent.ts)
