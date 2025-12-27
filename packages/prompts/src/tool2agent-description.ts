/**
 * A description of the tool2agent protocol for LLMs.
 * Include this in your system prompt to help the LLM understand how to interpret
 * structured feedback from tool2agent-enabled tools.
 */
export const tool2agentDescription = `## tool2agent Protocol

tool2agent is a protocol for structured LLM tool feedback that enables you to navigate complex constraints through trial and error.

### How it works

When you call a tool2agent-enabled tool (marked with [tool2agent] in the description), the response will follow a structured format:

1. **Success response** (\`ok: true\`): The tool call was accepted. The response contains the result data along with optional feedback and instructions.

2. **Failure response** (\`ok: false\`): The tool call was rejected. The response contains structured feedback to help you refine your input:
   - \`problems\`: General issues with the request
   - \`validationResults\`: Per-parameter feedback including:
     - \`valid\`: Whether this specific parameter is acceptable
     - \`problems\`: Issues with this parameter
     - \`allowedValues\`: Exhaustive list of acceptable values (if provided)
     - \`suggestedValues\`: Non-exhaustive suggestions (if provided)
     - \`normalizedValue\`: The canonical form of the value (if applicable)
     - \`requiresValidParameters\`: Other parameters that must be valid first
   - \`feedback\`: Additional context about the result
   - \`instructions\`: Suggested next steps

### Best practices

- When a tool call fails, carefully read the structured feedback to understand what needs to change
- Pay attention to \`allowedValues\` when provided - these are the only acceptable options
- Use \`suggestedValues\` as hints, but note they may not be exhaustive
- If \`requiresValidParameters\` is set, fix those parameters first before retrying
- Iterate on your tool calls based on the feedback until you succeed`;
