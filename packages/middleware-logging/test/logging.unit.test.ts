import { expect } from 'chai';
import { describe, it } from 'mocha';
import { tool2agent } from '@tool2agent/ai';
import { logging, type LogEntry } from '../src/index.js';
import type { ToolCallOptions } from '@ai-sdk/provider-utils';
import { z } from 'zod';
import type { ToolCallResult } from '@tool2agent/types';

const inputSchema = z.object({ query: z.string() });
const outputSchema = z.object({ result: z.string() });

type InputType = z.infer<typeof inputSchema>;
type OutputType = z.infer<typeof outputSchema>;

describe('logging middleware', () => {
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
    it('logs tool call with correct input', async () => {
      const baseTool = createBaseTool();
      let loggedEntry: LogEntry<InputType, OutputType> | undefined;

      const loggedTool = logging<InputType, OutputType>({
        logger: entry => {
          loggedEntry = entry;
        },
      }).applyTo(baseTool);

      await loggedTool.execute({ query: 'test' }, toolCallOptions);

      expect(loggedEntry).to.not.be.undefined;
      expect(loggedEntry!.input).to.deep.equal({ query: 'test' });
    });

    it('logs tool call with correct result', async () => {
      const baseTool = createBaseTool();
      let loggedEntry: LogEntry<InputType, OutputType> | undefined;

      const loggedTool = logging<InputType, OutputType>({
        logger: entry => {
          loggedEntry = entry;
        },
      }).applyTo(baseTool);

      await loggedTool.execute({ query: 'test' }, toolCallOptions);

      expect(loggedEntry).to.not.be.undefined;
      expect(loggedEntry!.result.ok).to.be.true;
      if (loggedEntry!.result.ok) {
        expect(loggedEntry!.result.result).to.equal('Processed: test');
      }
    });

    it('logs tool call options', async () => {
      const baseTool = createBaseTool();
      let loggedEntry: LogEntry<InputType, OutputType> | undefined;

      const loggedTool = logging<InputType, OutputType>({
        logger: entry => {
          loggedEntry = entry;
        },
      }).applyTo(baseTool);

      await loggedTool.execute({ query: 'test' }, toolCallOptions);

      expect(loggedEntry).to.not.be.undefined;
      expect(loggedEntry!.options.toolCallId).to.equal('test-id');
    });

    it('returns the original result unchanged', async () => {
      const baseTool = createBaseTool();

      const loggedTool = logging<InputType, OutputType>({
        logger: () => {},
      }).applyTo(baseTool);

      const result = await loggedTool.execute({ query: 'test' }, toolCallOptions);

      expect(result.ok).to.be.true;
      if (result.ok) {
        expect(result.result).to.equal('Processed: test');
      }
    });
  });

  describe('timing information', () => {
    it('provides duration in milliseconds', async () => {
      const baseTool = createBaseTool();
      let loggedEntry: LogEntry<InputType, OutputType> | undefined;

      const loggedTool = logging<InputType, OutputType>({
        logger: entry => {
          loggedEntry = entry;
        },
      }).applyTo(baseTool);

      await loggedTool.execute({ query: 'test' }, toolCallOptions);

      expect(loggedEntry).to.not.be.undefined;
      expect(loggedEntry!.durationMs).to.be.a('number');
      expect(loggedEntry!.durationMs).to.be.at.least(0);
    });

    it('provides startedAt timestamp', async () => {
      const baseTool = createBaseTool();
      let loggedEntry: LogEntry<InputType, OutputType> | undefined;

      const loggedTool = logging<InputType, OutputType>({
        logger: entry => {
          loggedEntry = entry;
        },
      }).applyTo(baseTool);

      const before = new Date();
      await loggedTool.execute({ query: 'test' }, toolCallOptions);
      const after = new Date();

      expect(loggedEntry).to.not.be.undefined;
      expect(loggedEntry!.startedAt).to.be.instanceOf(Date);
      expect(loggedEntry!.startedAt.getTime()).to.be.at.least(before.getTime());
      expect(loggedEntry!.startedAt.getTime()).to.be.at.most(after.getTime());
    });

    it('provides completedAt timestamp', async () => {
      const baseTool = createBaseTool();
      let loggedEntry: LogEntry<InputType, OutputType> | undefined;

      const loggedTool = logging<InputType, OutputType>({
        logger: entry => {
          loggedEntry = entry;
        },
      }).applyTo(baseTool);

      const before = new Date();
      await loggedTool.execute({ query: 'test' }, toolCallOptions);
      const after = new Date();

      expect(loggedEntry).to.not.be.undefined;
      expect(loggedEntry!.completedAt).to.be.instanceOf(Date);
      expect(loggedEntry!.completedAt.getTime()).to.be.at.least(before.getTime());
      expect(loggedEntry!.completedAt.getTime()).to.be.at.most(after.getTime());
    });

    it('completedAt is after or equal to startedAt', async () => {
      const baseTool = createBaseTool();
      let loggedEntry: LogEntry<InputType, OutputType> | undefined;

      const loggedTool = logging<InputType, OutputType>({
        logger: entry => {
          loggedEntry = entry;
        },
      }).applyTo(baseTool);

      await loggedTool.execute({ query: 'test' }, toolCallOptions);

      expect(loggedEntry).to.not.be.undefined;
      expect(loggedEntry!.completedAt.getTime()).to.be.at.least(loggedEntry!.startedAt.getTime());
    });

    it('measures duration correctly for slow operations', async () => {
      const slowTool = tool2agent({
        inputSchema,
        outputSchema,
        execute: async (params: InputType): Promise<ToolCallResult<InputType, OutputType>> => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return { ok: true, result: `Processed: ${params.query}` };
        },
      });

      let loggedEntry: LogEntry<InputType, OutputType> | undefined;

      const loggedTool = logging<InputType, OutputType>({
        logger: entry => {
          loggedEntry = entry;
        },
      }).applyTo(slowTool);

      await loggedTool.execute({ query: 'test' }, toolCallOptions);

      expect(loggedEntry).to.not.be.undefined;
      expect(loggedEntry!.durationMs).to.be.at.least(40); // Allow some margin
    });
  });

  describe('async logger support', () => {
    it('supports async logger functions', async () => {
      const baseTool = createBaseTool();
      let loggerCalled = false;

      const loggedTool = logging<InputType, OutputType>({
        logger: async entry => {
          await new Promise(resolve => setTimeout(resolve, 10));
          loggerCalled = true;
          expect(entry.input).to.deep.equal({ query: 'test' });
        },
      }).applyTo(baseTool);

      await loggedTool.execute({ query: 'test' }, toolCallOptions);

      expect(loggerCalled).to.be.true;
    });
  });

  describe('error logging', () => {
    it('logs failed tool calls', async () => {
      const failingTool = tool2agent({
        inputSchema,
        outputSchema,
        execute: async (): Promise<ToolCallResult<InputType, OutputType>> => {
          return { ok: false, problems: ['Something went wrong'] };
        },
      });

      let loggedEntry: LogEntry<InputType, OutputType> | undefined;

      const loggedTool = logging<InputType, OutputType>({
        logger: entry => {
          loggedEntry = entry;
        },
      }).applyTo(failingTool);

      const result = await loggedTool.execute({ query: 'test' }, toolCallOptions);

      expect(result.ok).to.be.false;
      expect(loggedEntry).to.not.be.undefined;
      expect(loggedEntry!.result.ok).to.be.false;
      if (!loggedEntry!.result.ok) {
        expect(loggedEntry!.result.problems).to.deep.equal(['Something went wrong']);
      }
    });
  });

  describe('multiple tool calls', () => {
    it('logs each tool call separately', async () => {
      const baseTool = createBaseTool();
      const loggedEntries: LogEntry<InputType, OutputType>[] = [];

      const loggedTool = logging<InputType, OutputType>({
        logger: entry => {
          loggedEntries.push(entry);
        },
      }).applyTo(baseTool);

      await loggedTool.execute({ query: 'first' }, { ...toolCallOptions, toolCallId: 'call-1' });
      await loggedTool.execute({ query: 'second' }, { ...toolCallOptions, toolCallId: 'call-2' });
      await loggedTool.execute({ query: 'third' }, { ...toolCallOptions, toolCallId: 'call-3' });

      expect(loggedEntries).to.have.length(3);
      expect(loggedEntries[0].input).to.deep.equal({ query: 'first' });
      expect(loggedEntries[0].options.toolCallId).to.equal('call-1');
      expect(loggedEntries[1].input).to.deep.equal({ query: 'second' });
      expect(loggedEntries[1].options.toolCallId).to.equal('call-2');
      expect(loggedEntries[2].input).to.deep.equal({ query: 'third' });
      expect(loggedEntries[2].options.toolCallId).to.equal('call-3');
    });
  });

  describe('complex input/output types', () => {
    it('handles complex input objects', async () => {
      const complexInputSchema = z.object({
        name: z.string(),
        age: z.number(),
        tags: z.array(z.string()),
      });
      const complexOutputSchema = z.object({ success: z.boolean(), id: z.number() });

      type ComplexInput = z.infer<typeof complexInputSchema>;
      type ComplexOutput = z.infer<typeof complexOutputSchema>;

      const baseTool = tool2agent({
        inputSchema: complexInputSchema,
        outputSchema: complexOutputSchema,
        execute: async (): Promise<ToolCallResult<ComplexInput, ComplexOutput>> => {
          return { ok: true, success: true, id: 42 };
        },
      });

      let loggedEntry: LogEntry<ComplexInput, ComplexOutput> | undefined;

      const loggedTool = logging<ComplexInput, ComplexOutput>({
        logger: entry => {
          loggedEntry = entry;
        },
      }).applyTo(baseTool);

      const input: ComplexInput = {
        name: 'John',
        age: 30,
        tags: ['developer', 'typescript'],
      };

      await loggedTool.execute(input, toolCallOptions);

      expect(loggedEntry).to.not.be.undefined;
      expect(loggedEntry!.input).to.deep.equal(input);
      expect(loggedEntry!.result.ok).to.be.true;
    });
  });
});
