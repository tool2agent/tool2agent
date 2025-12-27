/**
 * A prefix to add to tool2agent-enabled tool descriptions.
 * Adding this prefix helps the LLM identify which tools use the tool2agent protocol,
 * making it easier to correlate the protocol description with specific tool responses.
 *
 * @example
 * ```typescript
 * const myTool = tool2agent({
 *   description: `${tool2agentToolPrefix} Search for products in the catalog`,
 *   // ...
 * });
 * ```
 */
export const tool2agentToolPrefix = '[tool2agent]';

/**
 * Adds the tool2agent prefix to a tool description.
 *
 * @param description - The original tool description
 * @returns The description with the tool2agent prefix
 *
 * @example
 * ```typescript
 * const myTool = tool2agent({
 *   description: withTool2AgentPrefix('Search for products in the catalog'),
 *   // ...
 * });
 * // Result: "[tool2agent] Search for products in the catalog"
 * ```
 */
export function withTool2AgentPrefix(description: string): string {
  return `${tool2agentToolPrefix} ${description}`;
}
