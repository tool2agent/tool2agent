import { expect } from 'chai';
import { describe, it } from 'mocha';
import { tool2agent } from '@tool2agent/ai';
import { catchExceptions } from '../src/index.js';
import type { ToolCallOptions } from '@ai-sdk/provider-utils';
import { z } from 'zod';
import type { ToolCallResult } from '@tool2agent/types';

const inputSchema = z.object({ value: z.string() });
const outputSchema = z.object({ result: z.string() });

type InputType = z.infer<typeof inputSchema>;
type OutputType = z.infer<typeof outputSchema>;

describe('catchExceptions middleware', () => {
  const toolCallOptions: ToolCallOptions = {
    toolCallId: 'test-id',
    messages: [],
  };

  const createThrowingTool = (error: unknown) =>
    tool2agent({
      inputSchema,
      outputSchema,
      execute: async (): Promise<ToolCallResult<InputType, OutputType>> => {
        throw error;
      },
    });

  const createSuccessfulTool = () =>
    tool2agent({
      inputSchema,
      outputSchema,
      execute: async (params: InputType): Promise<ToolCallResult<InputType, OutputType>> => {
        return { ok: true, result: `Processed: ${params.value}` };
      },
    });

  describe('basic functionality', () => {
    it('allows successful calls to proceed', async () => {
      const baseTool = createSuccessfulTool();
      const safeTool = catchExceptions<InputType, OutputType>().applyTo(baseTool);

      const result = await safeTool.execute({ value: 'test' }, toolCallOptions);

      expect(result.ok).to.be.true;
      if (result.ok) {
        expect(result.result).to.equal('Processed: test');
      }
    });

    it('catches exceptions and returns ToolCallFailure', async () => {
      const error = new Error('Test error');
      const baseTool = createThrowingTool(error);
      const safeTool = catchExceptions<InputType, OutputType>().applyTo(baseTool);

      const result = await safeTool.execute({ value: 'test' }, toolCallOptions);

      expect(result.ok).to.be.false;
      if (!result.ok) {
        expect(result.problems).to.be.an('array').with.length.greaterThan(0);
        expect(result.problems![0]).to.include('Exception occured during tool call execution: ');
      }
    });
  });

  describe('error formatting', () => {
    it('handles Error with stack trace', async () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';
      const baseTool = createThrowingTool(error);
      const safeTool = catchExceptions<InputType, OutputType>().applyTo(baseTool);

      const result = await safeTool.execute({ value: 'test' }, toolCallOptions);

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

      const baseTool = createThrowingTool(error);
      const safeTool = catchExceptions<InputType, OutputType>().applyTo(baseTool);

      const result = await safeTool.execute({ value: 'test' }, toolCallOptions);

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

      const baseTool = createThrowingTool(error);
      const safeTool = catchExceptions<InputType, OutputType>().applyTo(baseTool);

      const result = await safeTool.execute({ value: 'test' }, toolCallOptions);

      expect(result.ok).to.be.false;
      if (!result.ok && result.problems) {
        expect(result.problems[0]).to.include('Exception occured during tool call execution: ');
        expect(result.problems[0]).to.include('Error');
      }
    });

    it('handles non-Error exceptions (string)', async () => {
      const baseTool = createThrowingTool('String error');
      const safeTool = catchExceptions<InputType, OutputType>().applyTo(baseTool);

      const result = await safeTool.execute({ value: 'test' }, toolCallOptions);

      expect(result.ok).to.be.false;
      if (!result.ok) {
        expect(result.problems).to.deep.equal([
          'Exception occured during tool call execution: "String error"',
        ]);
      }
    });

    it('handles non-Error exceptions (number)', async () => {
      const baseTool = createThrowingTool(42);
      const safeTool = catchExceptions<InputType, OutputType>().applyTo(baseTool);

      const result = await safeTool.execute({ value: 'test' }, toolCallOptions);

      expect(result.ok).to.be.false;
      if (!result.ok) {
        expect(result.problems).to.deep.equal(['Exception occured during tool call execution: 42']);
      }
    });

    it('handles non-Error exceptions (null)', async () => {
      const baseTool = createThrowingTool(null);
      const safeTool = catchExceptions<InputType, OutputType>().applyTo(baseTool);

      const result = await safeTool.execute({ value: 'test' }, toolCallOptions);

      expect(result.ok).to.be.false;
      if (!result.ok) {
        expect(result.problems).to.deep.equal([
          'Exception occured during tool call execution: null',
        ]);
      }
    });

    it('handles non-Error exceptions (undefined)', async () => {
      const baseTool = createThrowingTool(undefined);
      const safeTool = catchExceptions<InputType, OutputType>().applyTo(baseTool);

      const result = await safeTool.execute({ value: 'test' }, toolCallOptions);

      expect(result.ok).to.be.false;
      if (!result.ok) {
        expect(result.problems).to.deep.equal([
          'Exception occured during tool call execution: undefined',
        ]);
      }
    });

    it('handles non-Error exceptions (object)', async () => {
      const baseTool = createThrowingTool({ code: 500, message: 'Internal error' });
      const safeTool = catchExceptions<InputType, OutputType>().applyTo(baseTool);

      const result = await safeTool.execute({ value: 'test' }, toolCallOptions);

      expect(result.ok).to.be.false;
      if (!result.ok && result.problems) {
        expect(result.problems[0]).to.include('Exception occured during tool call execution: ');
        expect(result.problems[0]).to.include('{"code":500,"message":"Internal error"}');
      }
    });

    it('handles non-Error exceptions (function - JSON.stringify returns undefined)', async () => {
      const baseTool = createThrowingTool(() => {});
      const safeTool = catchExceptions<InputType, OutputType>().applyTo(baseTool);

      const result = await safeTool.execute({ value: 'test' }, toolCallOptions);

      expect(result.ok).to.be.false;
      if (!result.ok && result.problems) {
        expect(result.problems[0]).to.include('Exception occured during tool call execution: ');
        // Should fall back to String() when JSON.stringify returns undefined
        // Note: arrow function stringification may have spaces, so we check for the core pattern
        expect(result.problems[0]).to.match(/\(\) => \{\s*\}/);
      }
    });

    it('handles non-Error exceptions (object with circular reference - JSON.stringify throws)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const circular: any = { code: 500, message: 'Internal error' };
      circular.self = circular; // Create circular reference

      const baseTool = createThrowingTool(circular);
      const safeTool = catchExceptions<InputType, OutputType>().applyTo(baseTool);

      const result = await safeTool.execute({ value: 'test' }, toolCallOptions);

      expect(result.ok).to.be.false;
      if (!result.ok && result.problems) {
        expect(result.problems[0]).to.include('Exception occured during tool call execution: ');
        // Should fall back to String() for circular references
        expect(result.problems[0]).to.include('[object Object]');
      }
    });
  });

  describe('custom formatters', () => {
    it('uses custom formatProblems', async () => {
      const error = new Error('Custom error');
      const baseTool = createThrowingTool(error);
      const safeTool = catchExceptions<InputType, OutputType>({
        formatProblems: (err, input) => [
          `Failed for ${input.value}: ${err instanceof Error ? err.message : String(err)}`,
        ],
      }).applyTo(baseTool);

      const result = await safeTool.execute({ value: 'test' }, toolCallOptions);

      expect(result.ok).to.be.false;
      if (!result.ok) {
        expect(result.problems).to.deep.equal(['Failed for test: Custom error']);
      }
    });

    it('uses custom formatInstructions', async () => {
      const error = new Error('Test error');
      const baseTool = createThrowingTool(error);
      const safeTool = catchExceptions<InputType, OutputType>({
        formatInstructions: () => ['Please try again with different input.'],
      }).applyTo(baseTool);

      const result = await safeTool.execute({ value: 'test' }, toolCallOptions);

      expect(result.ok).to.be.false;
      if (!result.ok) {
        expect(result.instructions).to.deep.equal(['Please try again with different input.']);
      }
    });

    it('does not include instructions when formatInstructions returns undefined', async () => {
      const error = new Error('Test error');
      const baseTool = createThrowingTool(error);
      const safeTool = catchExceptions<InputType, OutputType>({
        formatInstructions: () => undefined,
      }).applyTo(baseTool);

      const result = await safeTool.execute({ value: 'test' }, toolCallOptions);

      expect(result.ok).to.be.false;
      if (!result.ok) {
        expect(result.instructions).to.be.undefined;
      }
    });
  });

  describe('onException callback', () => {
    it('calls onException when exception is caught', async () => {
      const error = new Error('Test error');
      const baseTool = createThrowingTool(error);
      let exceptionCalled = false;
      let caughtError: unknown;
      let caughtInput: InputType | undefined;

      const safeTool = catchExceptions<InputType, OutputType>({
        onException: (err, input) => {
          exceptionCalled = true;
          caughtError = err;
          caughtInput = input;
        },
      }).applyTo(baseTool);

      await safeTool.execute({ value: 'test' }, toolCallOptions);

      expect(exceptionCalled).to.be.true;
      expect(caughtError).to.equal(error);
      expect(caughtInput).to.deep.equal({ value: 'test' });
    });

    it('does not call onException for successful calls', async () => {
      const baseTool = createSuccessfulTool();
      let exceptionCalled = false;

      const safeTool = catchExceptions<InputType, OutputType>({
        onException: () => {
          exceptionCalled = true;
        },
      }).applyTo(baseTool);

      await safeTool.execute({ value: 'test' }, toolCallOptions);

      expect(exceptionCalled).to.be.false;
    });

    it('ignores exceptions thrown by onException callback', async () => {
      const error = new Error('Original error');
      const baseTool = createThrowingTool(error);

      const safeTool = catchExceptions<InputType, OutputType>({
        onException: () => {
          throw new Error('Callback error');
        },
      }).applyTo(baseTool);

      const result = await safeTool.execute({ value: 'test' }, toolCallOptions);

      // Should still return the original error, not the callback error
      expect(result.ok).to.be.false;
      if (!result.ok && result.problems) {
        expect(result.problems[0]).to.include('Original error');
      }
    });

    it('handles async onException callback', async () => {
      const error = new Error('Test error');
      const baseTool = createThrowingTool(error);
      let exceptionCalled = false;

      const safeTool = catchExceptions<InputType, OutputType>({
        onException: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          exceptionCalled = true;
        },
      }).applyTo(baseTool);

      await safeTool.execute({ value: 'test' }, toolCallOptions);

      expect(exceptionCalled).to.be.true;
    });
  });

  describe('middleware composition', () => {
    it('preserves other tool properties', async () => {
      const baseTool = tool2agent({
        description: 'A test tool',
        inputSchema,
        outputSchema,
        execute: async (): Promise<ToolCallResult<InputType, OutputType>> => {
          throw new Error('Test error');
        },
      });

      const safeTool = catchExceptions<InputType, OutputType>().applyTo(baseTool);

      expect(safeTool.description).to.equal('A test tool');
      expect(safeTool.inputSchema).to.equal(baseTool.inputSchema);
      expect(safeTool.outputSchema).to.equal(baseTool.outputSchema);
    });
  });
});
