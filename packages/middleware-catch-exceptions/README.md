# @tool2agent/middleware-catch-exceptions [![API docs](https://img.shields.io/badge/API%20docs-blue)](https://tool2agent.org/docs/)

Exception catching middleware for tool2agent. Catches exceptions during tool execution and converts them to structured `ToolCallFailure` responses with formatted error messages.

## Installation

```bash
pnpm add @tool2agent/middleware-catch-exceptions
```

## Usage

### Basic Usage

```typescript
import { catchExceptions } from '@tool2agent/middleware-catch-exceptions';
import { tool2agent } from '@tool2agent/ai';
import { z } from 'zod';

const tool = tool2agent({
  inputSchema,
  outputSchema,
  execute: async (input) => {
    // This might throw an exception
    const result = await riskyOperation(input);
    return { ok: true, result };
  },
});

// Apply the middleware to catch and format exceptions
const safeTool = catchExceptions<InputType, OutputType>().applyTo(tool);

// Exceptions are now caught and returned as structured failures
const result = await safeTool.execute({ query: 'test' }, ...);
// If an exception occurs:
// result = { ok: false, problems: ['Exception occured during tool call execution: Error: ...'] }
```

### With custom options

```typescript
const safeTool = catchExceptions<InputType, OutputType>({
  formatProblems: (error, input) => [
    `Failed to process ${input.query}: ${error instanceof Error ? error.message : String(error)}`
  ],
  formatInstructions: () => ['Please check your input and try again.'],
  onException: (error, input) => console.error('Tool execution failed:', error),
}).applyTo(tool);
```

### Error formatting

The default formatter handles various error types:

- `Error` objects with stack traces
- `Error` objects with name and message (no stack)
- Non-Error exceptions (strings, numbers, objects)
- Objects with circular references (falls back to `String()`)

### Middleware composition

This middleware can be composed with other middlewares using `.pipe()`:

```typescript
import { catchExceptions } from '@tool2agent/middleware-catch-exceptions';
import { idempotency } from '@tool2agent/middleware-idempotency';

const middleware = catchExceptions<InputType, OutputType>()
  .pipe(idempotency<InputType, OutputType>());

const safeTool = middleware.applyTo(baseTool);
```
