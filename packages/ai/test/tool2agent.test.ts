import { expect } from 'chai';
import { describe, it } from 'mocha';
import { type Tool2Agent, tool2agent } from '../src/tool2agent.js';
import { z } from 'zod';

const inputSchema = z.object({ value: z.string() });
const outputSchema = z.object({ result: z.string() });

type InputType = z.infer<typeof inputSchema>;
type OutputType = z.infer<typeof outputSchema>;

describe('tool2agent error handling', () => {
  describe('catchExceptions = true (default)', () => {
    it('handles Error with stack trace', async () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';

      const tool: Tool2Agent<InputType, OutputType> = tool2agent({
        inputSchema,
        outputSchema,
        execute: async () => {
          throw error;
        },
      });

      const result = await tool.execute({ value: 'test' }, { toolCallId: 'test', messages: [] });

      expect(result.ok).to.be.false;
      if (!result.ok) {
        expect(result.problems).to.deep.equal([
          'Exception occured during tool call execution: Error: Test error\n    at test.js:1:1',
        ]);
      }
    });

    it('handles Error with name and message (no stack)', async () => {
      const error = new Error('Test error');
      error.stack = undefined;
      error.name = 'CustomError';

      const tool: Tool2Agent<InputType, OutputType> = tool2agent({
        inputSchema,
        outputSchema,
        execute: async () => {
          throw error;
        },
      });

      const result = await tool.execute({ value: 'test' }, { toolCallId: 'test', messages: [] });

      expect(result.ok).to.be.false;
      if (!result.ok) {
        expect(result.problems).to.deep.equal([
          'Exception occured during tool call execution: CustomError: Test error',
        ]);
      }
    });

    it('handles Error with toString() fallback', async () => {
      const error = new Error('Test error');
      error.stack = undefined;
      // Remove name and message to force toString() fallback
      delete (error as unknown as { name?: string }).name;
      delete (error as unknown as { message?: string }).message;

      const tool: Tool2Agent<InputType, OutputType> = tool2agent({
        inputSchema,
        outputSchema,
        execute: async () => {
          throw error;
        },
      });

      const result = await tool.execute({ value: 'test' }, { toolCallId: 'test', messages: [] });

      expect(result.ok).to.be.false;
      if (!result.ok && result.problems) {
        expect(result.problems[0]).to.include('Exception occured during tool call execution: ');
        expect(result.problems[0]).to.include('Error');
      }
    });

    it('handles non-Error exceptions (string)', async () => {
      const tool = tool2agent({
        inputSchema,
        outputSchema,
        execute: async () => {
          throw 'String error';
        },
      });

      const result = await tool.execute({ value: 'test' }, { toolCallId: 'test', messages: [] });

      expect(result.ok).to.be.false;
      if (!result.ok) {
        expect(result.problems).to.deep.equal([
          'Exception occured during tool call execution: "String error"',
        ]);
      }
    });

    it('handles non-Error exceptions (number)', async () => {
      const tool = tool2agent({
        inputSchema,
        outputSchema,
        execute: async () => {
          throw 42;
        },
      });

      const result = await tool.execute({ value: 'test' }, { toolCallId: 'test', messages: [] });

      expect(result.ok).to.be.false;
      if (!result.ok) {
        expect(result.problems).to.deep.equal(['Exception occured during tool call execution: 42']);
      }
    });

    it('handles non-Error exceptions (null)', async () => {
      const tool = tool2agent({
        inputSchema,
        outputSchema,
        execute: async () => {
          throw null;
        },
      });

      const result = await tool.execute({ value: 'test' }, { toolCallId: 'test', messages: [] });

      expect(result.ok).to.be.false;
      if (!result.ok) {
        expect(result.problems).to.deep.equal([
          'Exception occured during tool call execution: null',
        ]);
      }
    });

    it('handles non-Error exceptions (undefined)', async () => {
      const tool = tool2agent({
        inputSchema,
        outputSchema,
        execute: async () => {
          throw undefined;
        },
      });

      const result = await tool.execute({ value: 'test' }, { toolCallId: 'test', messages: [] });

      expect(result.ok).to.be.false;
      if (!result.ok) {
        expect(result.problems).to.deep.equal([
          'Exception occured during tool call execution: undefined',
        ]);
      }
    });

    it('handles non-Error exceptions (object)', async () => {
      const tool = tool2agent({
        inputSchema,
        outputSchema,
        execute: async () => {
          throw { code: 500, message: 'Internal error' };
        },
      });

      const result = await tool.execute({ value: 'test' }, { toolCallId: 'test', messages: [] });

      expect(result.ok).to.be.false;
      if (!result.ok && result.problems) {
        expect(result.problems[0]).to.include('Exception occured during tool call execution: ');
        expect(result.problems[0]).to.include('{"code":500,"message":"Internal error"}');
      }
    });

    it('handles non-Error exceptions (function - JSON.stringify returns undefined)', async () => {
      const tool = tool2agent({
        inputSchema,
        outputSchema,
        execute: async () => {
          throw () => {};
        },
      });

      const result = await tool.execute({ value: 'test' }, { toolCallId: 'test', messages: [] });

      expect(result.ok).to.be.false;
      if (!result.ok && result.problems) {
        expect(result.problems[0]).to.include('Exception occured during tool call execution: ');
        // Should fall back to String() when JSON.stringify returns undefined
        expect(result.problems[0]).to.include('() => {}');
      }
    });

    it('handles non-Error exceptions (object with circular reference - JSON.stringify throws)', async () => {
      const circular: any = { code: 500, message: 'Internal error' };
      circular.self = circular; // Create circular reference

      const tool = tool2agent({
        inputSchema,
        outputSchema,
        execute: async () => {
          throw circular;
        },
      });

      const result = await tool.execute({ value: 'test' }, { toolCallId: 'test', messages: [] });

      expect(result.ok).to.be.false;
      if (!result.ok && result.problems) {
        expect(result.problems[0]).to.include('Exception occured during tool call execution: ');
        // Should fall back to String() for circular references
        expect(result.problems[0]).to.include('[object Object]');
      }
    });
  });

  describe('catchExceptions = false', () => {
    it('propagates exceptions when catchExceptions is false', async () => {
      const error = new Error('Test error');

      const tool = tool2agent({
        inputSchema,
        outputSchema,
        catchExceptions: false,
        execute: async () => {
          throw error;
        },
      });

      try {
        await tool.execute!({ value: 'test' }, { toolCallId: 'test', messages: [] });
        expect.fail('Expected exception to be thrown');
      } catch (thrownError) {
        expect(thrownError).to.equal(error);
      }
    });
  });
});
