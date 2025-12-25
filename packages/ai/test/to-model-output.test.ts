import { expect } from 'chai';
import { describe, it } from 'mocha';
import { z } from 'zod';
import {
  createToModelOutput,
  createTextToModelOutput,
  yamlLikeFormatter,
} from '../src/to-model-output.js';
import { tool2agent } from '../src/tool2agent.js';
import type { ToolCallResult } from '@tool2agent/types';

type TestInput = { query: string };
type TestOutput = { result: string; count: number };

describe('toModelOutput utilities', () => {
  describe('createToModelOutput', () => {
    it('converts success result to custom text output', () => {
      const toModelOutput = createToModelOutput<TestInput, TestOutput>({
        renderOutput: output => ({
          type: 'text',
          value: `Found ${output.count} results: ${output.result}`,
        }),
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

    it('converts success result with value field (non-record output)', () => {
      const toModelOutput = createToModelOutput<TestInput, string>({
        renderOutput: output => ({
          type: 'text',
          value: `Result: ${output}`,
        }),
      });

      const successResult: ToolCallResult<TestInput, string> = {
        ok: true,
        value: 'simple string result',
      };

      const output = toModelOutput(successResult);
      expect(output).to.deep.equal({
        type: 'text',
        value: 'Result: simple string result',
      });
    });

    it('appends feedback and instructions to text output', () => {
      const toModelOutput = createToModelOutput<TestInput, TestOutput>({
        renderOutput: output => ({
          type: 'text',
          value: `Count: ${output.count}`,
        }),
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
        expect(output.value).to.include('Feedback:');
        expect(output.value).to.include('Good job!');
        expect(output.value).to.include('Instructions:');
        expect(output.value).to.include('Continue with next step');
      }
    });

    it('appends feedback to content output', () => {
      const toModelOutput = createToModelOutput<TestInput, TestOutput>({
        renderOutput: output => ({
          type: 'content',
          value: [{ type: 'text', text: `Count: ${output.count}` }],
        }),
      });

      const successResult: ToolCallResult<TestInput, TestOutput> = {
        ok: true,
        result: 'test',
        count: 5,
        feedback: ['Important info'],
      };

      const output = toModelOutput(successResult);
      expect(output.type).to.equal('content');
      if (output.type === 'content') {
        expect(output.value).to.have.lengthOf(2);
        expect(output.value[0]).to.deep.equal({ type: 'text', text: 'Count: 5' });
        expect(output.value[1]).to.have.property('type', 'text');
        expect((output.value[1] as { type: 'text'; text: string }).text).to.include(
          'Important info',
        );
      }
    });

    it('excludes feedback when includeFeedback is false', () => {
      const toModelOutput = createToModelOutput<TestInput, TestOutput>({
        renderOutput: output => ({
          type: 'text',
          value: `Count: ${output.count}`,
        }),
        includeFeedback: false,
      });

      const successResult: ToolCallResult<TestInput, TestOutput> = {
        ok: true,
        result: 'test',
        count: 5,
        feedback: ['Should not appear'],
      };

      const output = toModelOutput(successResult);
      expect(output.type).to.equal('text');
      if (output.type === 'text') {
        expect(output.value).to.not.include('Should not appear');
      }
    });

    it('converts failure result with default renderer', () => {
      const toModelOutput = createToModelOutput<TestInput, TestOutput>({});

      const failureResult: ToolCallResult<TestInput, TestOutput> = {
        ok: false,
        validationResults: {
          query: {
            valid: false,
            problems: ['Query is too short'],
            suggestedValues: ['search term', 'another term'],
          },
        },
      };

      const output = toModelOutput(failureResult);
      expect(output.type).to.equal('text');
      if (output.type === 'text') {
        expect(output.value).to.include('Tool call failed');
        expect(output.value).to.include('query');
        expect(output.value).to.include('Query is too short');
        expect(output.value).to.include('Suggested values');
      }
    });

    it('converts failure with top-level problems', () => {
      const toModelOutput = createToModelOutput<TestInput, TestOutput>({});

      const failureResult: ToolCallResult<TestInput, TestOutput> = {
        ok: false,
        problems: ['General error occurred', 'Another problem'],
      };

      const output = toModelOutput(failureResult);
      expect(output.type).to.equal('text');
      if (output.type === 'text') {
        expect(output.value).to.include('General error occurred');
        expect(output.value).to.include('Another problem');
      }
    });

    it('uses custom failure renderer when provided', () => {
      const toModelOutput = createToModelOutput<TestInput, TestOutput>({
        renderFailure: failure => ({
          type: 'error-text',
          value: `Custom failure: ${JSON.stringify(failure)}`,
        }),
      });

      const failureResult: ToolCallResult<TestInput, TestOutput> = {
        ok: false,
        problems: ['Some error'],
      };

      const output = toModelOutput(failureResult);
      expect(output.type).to.equal('error-text');
      if (output.type === 'error-text') {
        expect(output.value).to.include('Custom failure');
        expect(output.value).to.include('Some error');
      }
    });

    it('supports multipart content with media', () => {
      type OutputWithImage = { name: string; imageBase64: string };

      const toModelOutput = createToModelOutput<TestInput, OutputWithImage>({
        renderOutput: output => ({
          type: 'content',
          value: [
            { type: 'text', text: `Image: ${output.name}` },
            { type: 'media', data: output.imageBase64, mediaType: 'image/png' },
          ],
        }),
      });

      const successResult: ToolCallResult<TestInput, OutputWithImage> = {
        ok: true,
        name: 'screenshot.png',
        imageBase64:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      };

      const output = toModelOutput(successResult);
      expect(output.type).to.equal('content');
      if (output.type === 'content') {
        expect(output.value).to.have.lengthOf(2);
        expect(output.value[0]).to.deep.equal({ type: 'text', text: 'Image: screenshot.png' });
        expect(output.value[1]).to.have.property('type', 'media');
        expect(output.value[1]).to.have.property('mediaType', 'image/png');
      }
    });
  });

  describe('createTextToModelOutput', () => {
    it('converts success result to formatted text', () => {
      const toModelOutput = createTextToModelOutput<TestInput, TestOutput>();

      const successResult: ToolCallResult<TestInput, TestOutput> = {
        ok: true,
        result: 'data',
        count: 10,
      };

      const output = toModelOutput(successResult);
      expect(output.type).to.equal('text');
      if (output.type === 'text') {
        // Default uses JSON.stringify with formatting
        expect(output.value).to.include('"result"');
        expect(output.value).to.include('"count"');
        expect(output.value).to.include('10');
      }
    });

    it('uses custom formatter', () => {
      const toModelOutput = createTextToModelOutput<TestInput, TestOutput>({
        formatOutput: output => `Result=${output.result}, Count=${output.count}`,
      });

      const successResult: ToolCallResult<TestInput, TestOutput> = {
        ok: true,
        result: 'test',
        count: 5,
      };

      const output = toModelOutput(successResult);
      expect(output.type).to.equal('text');
      if (output.type === 'text') {
        expect(output.value).to.equal('Result=test, Count=5');
      }
    });
  });

  describe('yamlLikeFormatter', () => {
    it('formats primitive values', () => {
      expect(yamlLikeFormatter('hello')).to.equal('hello');
      expect(yamlLikeFormatter(42)).to.equal('42');
      expect(yamlLikeFormatter(true)).to.equal('true');
      expect(yamlLikeFormatter(null)).to.equal('null');
    });

    it('formats simple objects', () => {
      const result = yamlLikeFormatter({ name: 'test', count: 5 });
      expect(result).to.include('name: test');
      expect(result).to.include('count: 5');
    });

    it('formats arrays', () => {
      const result = yamlLikeFormatter(['a', 'b', 'c']);
      expect(result).to.include('- a');
      expect(result).to.include('- b');
      expect(result).to.include('- c');
    });

    it('formats nested objects', () => {
      const result = yamlLikeFormatter({
        user: { name: 'John', age: 30 },
      });
      expect(result).to.include('user:');
      expect(result).to.include('name: John');
      expect(result).to.include('age: 30');
    });

    it('formats empty objects and arrays', () => {
      expect(yamlLikeFormatter({})).to.equal('{}');
      expect(yamlLikeFormatter([])).to.equal('[]');
    });

    it('handles multi-line strings', () => {
      const result = yamlLikeFormatter('line1\nline2\nline3');
      expect(result).to.include('|');
      expect(result).to.include('line1');
      expect(result).to.include('line2');
    });
  });

  describe('integration with tool2agent', () => {
    it('works with tool2agent toModelOutput parameter', async () => {
      const inputSchema = z.object({ query: z.string() });
      const outputSchema = z.object({ result: z.string() });

      const toModelOutput = createToModelOutput<
        z.infer<typeof inputSchema>,
        z.infer<typeof outputSchema>
      >({
        renderOutput: output => ({
          type: 'text',
          value: `Search result: ${output.result}`,
        }),
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
  });
});
