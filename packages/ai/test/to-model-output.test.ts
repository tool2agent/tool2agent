import { expect } from 'chai';
import { describe, it } from 'mocha';
import { z } from 'zod';
import { createTextOutput, createJsonOutput } from '../src/to-model-output.js';
import { tool2agent } from '../src/tool2agent.js';
import type { ToolCallResult } from '@tool2agent/types';

type TestInput = { query: string };
type TestOutput = { result: string; count: number };

describe('toModelOutput utilities', () => {
  describe('createTextOutput', () => {
    it('converts success result to text output', () => {
      const toModelOutput = createTextOutput<TestInput, TestOutput>(result => {
        if (result.ok) {
          return `Found ${result.count} results: ${result.result}`;
        }
        return 'Failed';
      });

      const successResult: ToolCallResult<TestInput, TestOutput> = {
        ok: true,
        result: 'test data',
        count: 42,
      };

      const output = toModelOutput(successResult);
      expect(output).to.deep.equal({
        type: 'text',
        value: 'Found 42 results: test data',
      });
    });

    it('converts failure result to text output', () => {
      const toModelOutput = createTextOutput<TestInput, TestOutput>(result => {
        if (result.ok) {
          return `Success: ${result.result}`;
        }
        return `Error: ${result.problems?.join(', ') ?? 'Unknown error'}`;
      });

      const failureResult: ToolCallResult<TestInput, TestOutput> = {
        ok: false,
        problems: ['Query is too short', 'Invalid format'],
      };

      const output = toModelOutput(failureResult);
      expect(output).to.deep.equal({
        type: 'text',
        value: 'Error: Query is too short, Invalid format',
      });
    });

    it('handles result with feedback and instructions', () => {
      const toModelOutput = createTextOutput<TestInput, TestOutput>(result => {
        const lines: string[] = [];
        if (result.ok) {
          lines.push(`Count: ${result.count}`);
        }
        if (result.feedback?.length) {
          lines.push(`Feedback: ${result.feedback.join(', ')}`);
        }
        if (result.instructions?.length) {
          lines.push(`Instructions: ${result.instructions.join(', ')}`);
        }
        return lines.join('\n');
      });

      const successResult: ToolCallResult<TestInput, TestOutput> = {
        ok: true,
        result: 'test',
        count: 5,
        feedback: ['Good job!'],
        instructions: ['Continue with next step'],
      };

      const output = toModelOutput(successResult);
      expect(output.type).to.equal('text');
      if (output.type === 'text') {
        expect(output.value).to.include('Count: 5');
        expect(output.value).to.include('Feedback: Good job!');
        expect(output.value).to.include('Instructions: Continue with next step');
      }
    });
  });

  describe('createJsonOutput', () => {
    it('returns result as JSON without transformation', () => {
      const toModelOutput = createJsonOutput<TestInput, TestOutput>();

      const successResult: ToolCallResult<TestInput, TestOutput> = {
        ok: true,
        result: 'data',
        count: 10,
      };

      const output = toModelOutput(successResult);
      expect(output).to.deep.equal({
        type: 'json',
        value: successResult,
      });
    });

    it('transforms result when transform function is provided', () => {
      const toModelOutput = createJsonOutput<TestInput, TestOutput>(result => ({
        success: result.ok,
        data: result.ok ? { result: result.result, count: result.count } : null,
      }));

      const successResult: ToolCallResult<TestInput, TestOutput> = {
        ok: true,
        result: 'test',
        count: 5,
      };

      const output = toModelOutput(successResult);
      expect(output).to.deep.equal({
        type: 'json',
        value: {
          success: true,
          data: { result: 'test', count: 5 },
        },
      });
    });

    it('handles failure result with transformation', () => {
      const toModelOutput = createJsonOutput<TestInput, TestOutput>(result => ({
        success: result.ok,
        errors: result.ok ? null : result.problems,
      }));

      const failureResult: ToolCallResult<TestInput, TestOutput> = {
        ok: false,
        problems: ['Error 1', 'Error 2'],
      };

      const output = toModelOutput(failureResult);
      expect(output).to.deep.equal({
        type: 'json',
        value: {
          success: false,
          errors: ['Error 1', 'Error 2'],
        },
      });
    });
  });

  describe('integration with tool2agent', () => {
    it('works with tool2agent toModelOutput parameter', async () => {
      const inputSchema = z.object({ query: z.string() });
      const outputSchema = z.object({ result: z.string() });

      const toModelOutput = createTextOutput<
        z.infer<typeof inputSchema>,
        z.infer<typeof outputSchema>
      >(result => {
        if (result.ok) {
          return `Search result: ${result.result}`;
        }
        return `Error: ${result.problems?.join(', ')}`;
      });

      const tool = tool2agent({
        inputSchema,
        outputSchema,
        execute: async input => ({
          ok: true as const,
          result: `Found: ${input.query}`,
        }),
        toModelOutput,
      });

      // Verify toModelOutput is correctly attached to the tool
      expect(tool.toModelOutput).to.exist;
      expect(tool.toModelOutput).to.equal(toModelOutput);

      // Execute and verify toModelOutput transforms the result
      const result = await tool.execute({ query: 'test' }, { toolCallId: 'test', messages: [] });
      expect(result.ok).to.be.true;

      if (tool.toModelOutput) {
        const modelOutput = tool.toModelOutput(result);
        expect(modelOutput.type).to.equal('text');
        if (modelOutput.type === 'text') {
          expect(modelOutput.value).to.equal('Search result: Found: test');
        }
      }
    });

    it('works with createJsonOutput', async () => {
      const inputSchema = z.object({ id: z.number() });
      const outputSchema = z.object({ name: z.string() });

      const toModelOutput = createJsonOutput<
        z.infer<typeof inputSchema>,
        z.infer<typeof outputSchema>
      >(result => ({
        status: result.ok ? 'success' : 'error',
        payload: result.ok ? { name: result.name } : null,
      }));

      const tool = tool2agent({
        inputSchema,
        outputSchema,
        execute: async input => ({
          ok: true as const,
          name: `Item ${input.id}`,
        }),
        toModelOutput,
      });

      const result = await tool.execute({ id: 42 }, { toolCallId: 'test', messages: [] });
      expect(result.ok).to.be.true;

      if (tool.toModelOutput) {
        const modelOutput = tool.toModelOutput(result);
        expect(modelOutput.type).to.equal('json');
        if (modelOutput.type === 'json') {
          expect(modelOutput.value).to.deep.equal({
            status: 'success',
            payload: { name: 'Item 42' },
          });
        }
      }
    });
  });
});
