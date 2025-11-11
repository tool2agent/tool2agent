import { expect } from 'chai';
import { describe, it } from 'mocha';
import { tool2agent } from '@tool2agent/ai';
import { idempotency, type IdempotencySet } from '../src/index.js';
import type { ToolCallOptions } from '@ai-sdk/provider-utils';
import { z } from 'zod';
import type { ToolCallResult } from '@tool2agent/types';

const inputSchema = z.object({ query: z.string() });
const outputSchema = z.object({ result: z.string() });

type InputType = z.infer<typeof inputSchema>;
type OutputType = z.infer<typeof outputSchema>;

describe('idempotency middleware', () => {
  const createBaseTool = () =>
    tool2agent({
      inputSchema,
      outputSchema,
      execute: async (params: InputType): Promise<ToolCallResult<InputType, OutputType>> => {
        return { ok: true, result: `Processed: ${params.query}` };
      },
    });

  const toolCallOptions: ToolCallOptions = {
    toolCallId: 'test-id',
    messages: [],
  };

  describe('basic functionality', () => {
    it('allows first call to proceed', async () => {
      const baseTool = createBaseTool();
      const idempotentTool = idempotency<InputType, OutputType>().applyTo(baseTool);

      const result = await idempotentTool.execute({ query: 'test' }, toolCallOptions);

      expect(result.ok).to.be.true;
      if (result.ok) {
        expect(result.result).to.equal('Processed: test');
      }
    });

    it('blocks duplicate calls with same input', async () => {
      const baseTool = createBaseTool();
      const idempotentTool = idempotency<InputType, OutputType>().applyTo(baseTool);

      // First call should succeed
      const firstResult = await idempotentTool.execute({ query: 'test' }, toolCallOptions);
      expect(firstResult.ok).to.be.true;

      // Second call with same input should be blocked
      const secondResult = await idempotentTool.execute({ query: 'test' }, toolCallOptions);
      expect(secondResult.ok).to.be.false;
      if (!secondResult.ok) {
        expect(secondResult.problems).to.be.an('array').with.length.greaterThan(0);
        expect(secondResult.instructions).to.be.an('array').with.length.greaterThan(0);
      }
    });

    it('allows calls with different inputs', async () => {
      const baseTool = createBaseTool();
      const idempotentTool = idempotency<InputType, OutputType>().applyTo(baseTool);

      const result1 = await idempotentTool.execute({ query: 'test1' }, toolCallOptions);
      expect(result1.ok).to.be.true;

      const result2 = await idempotentTool.execute({ query: 'test2' }, toolCallOptions);
      expect(result2.ok).to.be.true;
    });
  });

  describe('custom formatters', () => {
    it('uses custom formatters', async () => {
      const baseTool = createBaseTool();
      const idempotentTool = idempotency<InputType, OutputType>({
        formatProblems: (input: InputType) => [`Duplicate detected for: ${input.query}`],
        formatInstructions: (input: InputType) => [
          `Please avoid calling with query: ${input.query}`,
        ],
      }).applyTo(baseTool);

      await idempotentTool.execute({ query: 'test' }, toolCallOptions);
      const duplicateResult = await idempotentTool.execute({ query: 'test' }, toolCallOptions);

      expect(duplicateResult.ok).to.be.false;
      if (!duplicateResult.ok) {
        expect(duplicateResult.problems).to.include('Duplicate detected for: test');
        expect(duplicateResult.instructions).to.include('Please avoid calling with query: test');
      }
    });
  });

  describe('logging callback', () => {
    it('calls onDuplicate when duplicate is detected', async () => {
      const baseTool = createBaseTool();
      let duplicateCalled = false;
      let duplicateInput: InputType | undefined;

      const idempotentTool = idempotency<InputType, OutputType>({
        onDuplicate: (input: InputType) => {
          duplicateCalled = true;
          duplicateInput = input;
        },
      }).applyTo(baseTool);

      await idempotentTool.execute({ query: 'test' }, toolCallOptions);
      await idempotentTool.execute({ query: 'test' }, toolCallOptions);

      expect(duplicateCalled).to.be.true;
      expect(duplicateInput).to.deep.equal({ query: 'test' });
    });

    it('does not call onDuplicate for first call', async () => {
      const baseTool = createBaseTool();
      let duplicateCalled = false;

      const idempotentTool = idempotency<InputType, OutputType>({
        onDuplicate: () => {
          duplicateCalled = true;
        },
      }).applyTo(baseTool);

      await idempotentTool.execute({ query: 'test' }, toolCallOptions);

      expect(duplicateCalled).to.be.false;
    });
  });

  describe('custom set implementation', () => {
    it('uses custom set implementation', async () => {
      class CustomSet<InputType> implements IdempotencySet<InputType> {
        private readonly items: InputType[] = [];

        has(input: InputType): boolean {
          return this.items.some(item => JSON.stringify(item) === JSON.stringify(input));
        }

        add(input: InputType): void {
          if (!this.has(input)) {
            this.items.push(input);
          }
        }
      }

      const baseTool = createBaseTool();
      const customSet = new CustomSet<InputType>();
      const idempotentTool = idempotency<InputType, OutputType>({ set: customSet }).applyTo(
        baseTool,
      );

      await idempotentTool.execute({ query: 'test' }, toolCallOptions);
      const duplicateResult = await idempotentTool.execute({ query: 'test' }, toolCallOptions);

      expect(duplicateResult.ok).to.be.false;
    });

    it('supports async set operations', async () => {
      class AsyncSet<InputType> implements IdempotencySet<InputType> {
        private readonly items: InputType[] = [];

        async has(input: InputType): Promise<boolean> {
          return this.items.some(item => JSON.stringify(item) === JSON.stringify(input));
        }

        async add(input: InputType): Promise<void> {
          if (!(await this.has(input))) {
            this.items.push(input);
          }
        }
      }

      const baseTool = createBaseTool();
      const asyncSet = new AsyncSet<InputType>();
      const idempotentTool = idempotency<InputType, OutputType>({ set: asyncSet }).applyTo(
        baseTool,
      );

      await idempotentTool.execute({ query: 'test' }, toolCallOptions);
      const duplicateResult = await idempotentTool.execute({ query: 'test' }, toolCallOptions);

      expect(duplicateResult.ok).to.be.false;
    });
  });

  describe('edge cases', () => {
    it('handles complex input objects', async () => {
      const complexInputSchema = z.object({
        name: z.string(),
        age: z.number(),
        tags: z.array(z.string()),
      });
      const complexOutputSchema = z.object({ success: z.boolean() });

      type ComplexInput = z.infer<typeof complexInputSchema>;
      type ComplexOutput = z.infer<typeof complexOutputSchema>;

      const baseTool = tool2agent({
        inputSchema: complexInputSchema,
        outputSchema: complexOutputSchema,
        execute: async (): Promise<ToolCallResult<ComplexInput, ComplexOutput>> => {
          return { ok: true, success: true };
        },
      });

      const idempotentTool = idempotency<ComplexInput, ComplexOutput>().applyTo(baseTool);

      const input: ComplexInput = {
        name: 'John',
        age: 30,
        tags: ['developer', 'typescript'],
      };

      await idempotentTool.execute(input, toolCallOptions);
      const duplicateResult = await idempotentTool.execute(input, toolCallOptions);

      expect(duplicateResult.ok).to.be.false;
    });
  });
});
