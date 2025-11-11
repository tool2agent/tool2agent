# @tool2agent/middleware-idempotency [![API docs](https://img.shields.io/badge/API%20docs-blue)](https://tool2agent.org/docs/)

Idempotency middleware for tool2agent. Prevents multiple tool calls with the same input.

## Installation

```bash
pnpm add @tool2agent/middleware-idempotency
```

## Usage

### Basic Usage

```typescript
import { idempotency } from '@tool2agent/middleware-idempotency';
import { tool2agent } from '@tool2agent/ai';
import { z } from 'zod';

const tool = tool2agent({
  inputSchema,
  outputSchema,
  execute: async (input) => {
    return { ok: true, result: `Processed: ${input.query}` };
  },
});

const idempotentTool = idempotency<InputType, OutputType>().applyTo(tool);

// First call - executes successfully
const result1 = await idempotentTool.execute({ query: 'test' }, ...);
// result1 = { ok: true, result: 'Processed: test' }

// Second call with same input - blocked by idempotency
const result2 = await idempotentTool.execute({ query: 'test' }, ...);
// result2 = { ok: false,
// problems: ['Tool call processing skipped: the tool has been called with this payload already.'],
// instructions: ['This tool is idempotent. Avoid issuing duplicate tool calls in the future.'] }

```

Be aware that such tool object leaks memory until GC'd, because it stores object hashes.

### With custom options

```typescript
const idempotentTool = idempotency<InputType, OutputType>({
  formatProblems: input => [`Duplicate call detected for query: ${input.query}`],
  formatInstructions: () => ['This tool call was already executed. Please avoid duplicate calls.'],
  onDuplicate: input => console.log('Duplicate detected:', input),
}).applyTo(tool);
```

### With custom input uniqueness check

By default, [object-hash](https://www.npmjs.com/package/object-hash) is used to check for duplicates.

You can provide a custom set-like implementation:

```typescript
import { idempotency, type IdempotencySet } from '@tool2agent/middleware-idempotency';

class RedisSet<InputType> implements IdempotencySet<InputType> {
  async has(input: InputType): Promise<boolean> {
    // Check Redis for the input
    return await redis.exists(JSON.stringify(input));
  }

  async add(input: InputType): Promise<void> {
    // Store in Redis
    await redis.set(JSON.stringify(input), '1', 'EX', 3600);
  }
}

const idempotentTool = idempotency({
  set: new RedisSet(),
}).applyTo(tool);
```
