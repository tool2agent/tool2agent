# @tool2agent/prompts [![API docs](https://img.shields.io/badge/API%20docs-blue)](https://tool2agent.org/docs/)

Reusable prompt fragments for the [tool2agent](https://github.com/tool2agent/tool2agent) protocol. Include these in your system prompts to help LLMs understand and effectively use tool2agent-enabled tools.

## Install

```bash
pnpm add @tool2agent/prompts
```

## Usage

### Protocol description

Add `tool2agentDescription` to your system prompt to help the LLM understand the tool2agent protocol:

```typescript
import { tool2agentDescription } from '@tool2agent/prompts';

const systemPrompt = `You are a helpful assistant.

${tool2agentDescription}`;
```

### Tool description prefix

Mark your tool2agent-enabled tools with the `[tool2agent]` prefix to help the LLM identify which tools use the protocol:

```typescript
import { withTool2AgentPrefix, tool2agentToolPrefix } from '@tool2agent/prompts';
import { tool2agent } from '@tool2agent/ai';

// Using the helper function
const myTool = tool2agent({
  description: withTool2AgentPrefix('Search for products in the catalog'),
  // ...
});

// Or using the prefix directly
const anotherTool = tool2agent({
  description: `${tool2agentToolPrefix} Book a flight`,
  // ...
});
```

## Exports

- `tool2agentDescription` - A comprehensive description of the tool2agent protocol for LLMs
- `tool2agentToolPrefix` - The `[tool2agent]` string constant
- `withTool2AgentPrefix(description)` - Helper function to add the prefix to tool descriptions
