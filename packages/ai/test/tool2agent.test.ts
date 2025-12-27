import { expect } from 'chai';
import { describe, it } from 'mocha';
import { type Tool2Agent, tool2agent } from '../src/tool2agent.js';
import { z } from 'zod';

const inputSchema = z.object({ value: z.string() });
const outputSchema = z.object({ result: z.string() });

type InputType = z.infer<typeof inputSchema>;
type OutputType = z.infer<typeof outputSchema>;

describe('tool2agent', () => {
  describe('basic functionality', () => {
    it('creates a tool that executes successfully', async () => {
      const tool: Tool2Agent<InputType, OutputType> = tool2agent({
        inputSchema,
        outputSchema,
        execute: async params => {
          return { ok: true, result: `Processed: ${params.value}` };
        },
      });

      const result = await tool.execute({ value: 'test' }, { toolCallId: 'test', messages: [] });

      expect(result.ok).to.be.true;
      if (result.ok) {
        expect(result.result).to.equal('Processed: test');
      }
    });

    it('preserves tool description', async () => {
      const tool: Tool2Agent<InputType, OutputType> = tool2agent({
        description: 'A test tool',
        inputSchema,
        outputSchema,
        execute: async () => {
          return { ok: true, result: 'test' };
        },
      });

      expect(tool.description).to.equal('A test tool');
    });

    it('has input and output schemas', async () => {
      const tool: Tool2Agent<InputType, OutputType> = tool2agent({
        inputSchema,
        outputSchema,
        execute: async () => {
          return { ok: true, result: 'test' };
        },
      });

      expect(tool.inputSchema).to.exist;
      expect(tool.outputSchema).to.exist;
    });
  });

  describe('exception propagation', () => {
    it('propagates exceptions (use catchExceptions middleware to catch them)', async () => {
      const error = new Error('Test error');

      const tool = tool2agent({
        inputSchema,
        outputSchema,
        execute: async () => {
          throw error;
        },
      });

      try {
        await tool.execute({ value: 'test' }, { toolCallId: 'test', messages: [] });
        expect.fail('Expected exception to be thrown');
      } catch (thrownError) {
        expect(thrownError).to.equal(error);
      }
    });
  });
});
