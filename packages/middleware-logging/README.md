# @tool2agent/middleware-logging [![API docs](https://img.shields.io/badge/API%20docs-blue)](https://tool2agent.org/docs/)

Logging middleware for tool2agent. Logs tool call inputs, outputs, and timing information.

## Installation

```bash
pnpm add @tool2agent/middleware-logging
```

## Usage

### Basic Usage

```typescript
import { logging } from '@tool2agent/middleware-logging';
import { tool2agent } from '@tool2agent/ai';
import { z } from 'zod';

const tool = tool2agent({
  inputSchema,
  outputSchema,
  execute: async input => {
    return { ok: true, result: `Processed: ${input.query}` };
  },
});

const loggedTool = logging<InputType, OutputType>({
  logger: entry => console.log('Tool call:', entry),
}).applyTo(tool);

// Execute the tool - logging happens automatically
const result = await loggedTool.execute({ query: 'test' }, options);
// Console output:
// Tool call: {
//   input: { query: 'test' },
//   result: { ok: true, result: 'Processed: test' },
//   options: { toolCallId: '...', messages: [...] },
//   durationMs: 5.123,
//   startedAt: 2024-01-01T00:00:00.000Z,
//   completedAt: 2024-01-01T00:00:00.005Z
// }
```

### Log Entry Structure

The logger function receives a `LogEntry` object with the following properties:

```typescript
interface LogEntry<InputType, OutputType> {
  input: InputType; // The input passed to the tool
  result: ToolCallResult<InputType, OutputType>; // The result from the tool
  options: ToolCallOptions; // Tool call options (includes toolCallId)
  durationMs: number; // Execution duration in milliseconds
  startedAt: Date; // When the tool call started
  completedAt: Date; // When the tool call completed
}
```

### Async Logger

The logger function can be async, useful for sending logs to external services:

```typescript
const loggedTool = logging<InputType, OutputType>({
  logger: async entry => {
    await saveToDatabase({
      toolCallId: entry.options.toolCallId,
      input: entry.input,
      success: entry.result.ok,
      durationMs: entry.durationMs,
      timestamp: entry.startedAt,
    });
  },
}).applyTo(tool);
```

### Composing with Other Middleware

```typescript
import { logging } from '@tool2agent/middleware-logging';
import { idempotency } from '@tool2agent/middleware-idempotency';

const tool = logging<InputType, OutputType>({
  logger: entry => console.log(entry),
})
  .pipe(idempotency<InputType, OutputType>())
  .applyTo(baseTool);
```

### Custom Logger Examples

#### File logging

```typescript
import * as fs from 'fs';

const loggedTool = logging<InputType, OutputType>({
  logger: entry => {
    const logLine =
      JSON.stringify({
        timestamp: entry.startedAt.toISOString(),
        toolCallId: entry.options.toolCallId,
        success: entry.result.ok,
        durationMs: entry.durationMs,
      }) + '\n';
    fs.appendFileSync('tool-calls.log', logLine);
  },
}).applyTo(tool);
```

#### Structured logging with Winston/Pino

```typescript
import pino from 'pino';

const pinoLogger = pino();

const loggedTool = logging<InputType, OutputType>({
  logger: entry => {
    pinoLogger.info({
      event: 'tool_call',
      toolCallId: entry.options.toolCallId,
      success: entry.result.ok,
      durationMs: entry.durationMs,
      input: entry.input,
    });
  },
}).applyTo(tool);
```

#### Metrics collection

```typescript
const loggedTool = logging<InputType, OutputType>({
  logger: entry => {
    metrics.histogram('tool_call_duration', entry.durationMs);
    metrics.increment('tool_calls_total', {
      success: String(entry.result.ok),
    });
  },
}).applyTo(tool);
```
