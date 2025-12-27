import { tool2agentDescription, tool2agentToolPrefix, withTool2AgentPrefix } from '../src/index.js';

// Test that all exports are defined and have expected types
function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new Error(`Expected ${name} to be a string, got ${typeof value}`);
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.length === 0) {
    throw new Error(`Expected ${name} to be non-empty`);
  }
}

// Test tool2agentDescription
assertString(tool2agentDescription, 'tool2agentDescription');
assertNonEmpty(tool2agentDescription, 'tool2agentDescription');

// Verify it contains key protocol concepts
const requiredConcepts = [
  'ok: true',
  'ok: false',
  'problems',
  'validationResults',
  'allowedValues',
  'suggestedValues',
  '[tool2agent]',
];

for (const concept of requiredConcepts) {
  if (!tool2agentDescription.includes(concept)) {
    throw new Error(`tool2agentDescription should mention "${concept}"`);
  }
}

// Test tool2agentToolPrefix
assertString(tool2agentToolPrefix, 'tool2agentToolPrefix');
if (tool2agentToolPrefix !== '[tool2agent]') {
  throw new Error(
    `Expected tool2agentToolPrefix to be "[tool2agent]", got "${tool2agentToolPrefix}"`,
  );
}

// Test withTool2AgentPrefix
const testDescription = 'Search for products';
const prefixed = withTool2AgentPrefix(testDescription);

assertString(prefixed, 'withTool2AgentPrefix result');
if (!prefixed.startsWith('[tool2agent]')) {
  throw new Error(`Expected prefixed description to start with "[tool2agent]", got "${prefixed}"`);
}
if (!prefixed.includes(testDescription)) {
  throw new Error(`Expected prefixed description to include original description`);
}
if (prefixed !== `[tool2agent] ${testDescription}`) {
  throw new Error(`Expected "[tool2agent] ${testDescription}", got "${prefixed}"`);
}

// Test with empty description
const emptyPrefixed = withTool2AgentPrefix('');
if (emptyPrefixed !== '[tool2agent] ') {
  throw new Error(`Expected "[tool2agent] " for empty input, got "${emptyPrefixed}"`);
}

console.log('All tests passed!');
