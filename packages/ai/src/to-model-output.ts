import type { ToolCallResult, ToolCallSuccess, ToolCallFailure } from '@tool2agent/types';

/**
 * Text output for the language model.
 */
export type ModelOutputText = { type: 'text'; value: string };

/**
 * JSON output for the language model.
 */
export type ModelOutputJson = { type: 'json'; value: unknown };

/**
 * Error text output for the language model.
 */
export type ModelOutputErrorText = { type: 'error-text'; value: string };

/**
 * Error JSON output for the language model.
 */
export type ModelOutputErrorJson = { type: 'error-json'; value: unknown };

/**
 * Text content in a multipart model output.
 */
export type ContentPartText = { type: 'text'; text: string };

/**
 * Media content in a multipart model output.
 */
export type ContentPartMedia = {
  type: 'media';
  /** Base-64 encoded media data */
  data: string;
  /** IANA media type (e.g., 'image/png', 'image/jpeg') */
  mediaType: string;
};

/**
 * Multipart content output for the language model.
 */
export type ModelOutputContent = {
  type: 'content';
  value: Array<ContentPartText | ContentPartMedia>;
};

/**
 * The output type that toModelOutput can return.
 * This is compatible with the AI SDK's LanguageModelV2ToolResultPart['output'].
 */
export type ModelOutput =
  | ModelOutputText
  | ModelOutputJson
  | ModelOutputErrorText
  | ModelOutputErrorJson
  | ModelOutputContent;

/**
 * A function that renders an OutputType to a model output.
 * Can return various formats depending on the use case.
 */
export type OutputRenderer<OutputType> = (output: OutputType) => ModelOutput;

/**
 * A function that renders a failure result to a model output.
 * If not provided, a default text representation will be used.
 */
export type FailureRenderer<InputType> = (failure: ToolCallFailure<InputType>) => ModelOutput;

/**
 * Options for creating a toModelOutput function.
 */
export type CreateToModelOutputOptions<InputType, OutputType> = {
  /**
   * Renderer for successful results.
   * Takes the OutputType value from the success result.
   * If not provided, falls back to JSON representation.
   */
  renderOutput?: OutputRenderer<OutputType>;
  /**
   * Renderer for failure results.
   * If not provided, uses a default text representation of the failure.
   */
  renderFailure?: FailureRenderer<InputType>;
  /**
   * Whether to include feedback and instructions in the output.
   * Default is true.
   */
  includeFeedback?: boolean;
  /**
   * Whether to include instructions in the output.
   * Default is true.
   */
  includeInstructions?: boolean;
};

/**
 * Extracts the output value from a ToolCallSuccess.
 * Handles both record outputs (spread directly) and non-record outputs (wrapped in 'value').
 */
function extractOutputValue<OutputType>(
  success: ToolCallSuccess<OutputType>,
): OutputType | undefined {
  // If there's a 'value' field, it's a non-record output
  if ('value' in success) {
    return success.value as OutputType;
  }
  // For record outputs, extract all non-metadata fields
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ok, feedback, instructions, ...rest } = success;
  return rest as unknown as OutputType;
}

/**
 * Formats feedback and instructions as text lines.
 */
function formatFeedbackAndInstructions<InputType, OutputType>(
  result: ToolCallResult<InputType, OutputType>,
  options: { includeFeedback: boolean; includeInstructions: boolean },
): string[] {
  const lines: string[] = [];

  if (options.includeFeedback && result.feedback?.length) {
    lines.push('Feedback:');
    for (const fb of result.feedback) {
      lines.push(`  - ${fb}`);
    }
  }

  if (options.includeInstructions && result.instructions?.length) {
    lines.push('Instructions:');
    for (const inst of result.instructions) {
      lines.push(`  - ${inst}`);
    }
  }

  return lines;
}

/**
 * Default failure renderer that creates a text representation of the failure.
 */
function defaultFailureRenderer<InputType>(
  failure: ToolCallFailure<InputType>,
  options: { includeFeedback: boolean; includeInstructions: boolean },
): ModelOutput {
  const lines: string[] = ['Tool call failed.'];

  // Handle record input failures with validationResults
  if ('validationResults' in failure && failure.validationResults) {
    lines.push('Validation results:');
    for (const [param, result] of Object.entries(
      failure.validationResults as Record<string, unknown>,
    )) {
      const paramResult = result as {
        valid: boolean;
        problems?: string[];
        suggestedValues?: unknown[];
        allowedValues?: unknown[];
      };
      if (!paramResult.valid) {
        lines.push(`  ${param}:`);
        if (paramResult.problems?.length) {
          for (const problem of paramResult.problems) {
            lines.push(`    - ${problem}`);
          }
        }
        if (paramResult.suggestedValues?.length) {
          lines.push(`    Suggested values: ${JSON.stringify(paramResult.suggestedValues)}`);
        }
        if (paramResult.allowedValues) {
          lines.push(`    Allowed values: ${JSON.stringify(paramResult.allowedValues)}`);
        }
      }
    }
  }

  // Handle problems at the top level
  if ('problems' in failure && failure.problems?.length) {
    lines.push('Problems:');
    for (const problem of failure.problems) {
      lines.push(`  - ${problem}`);
    }
  }

  // Add feedback and instructions
  lines.push(
    ...formatFeedbackAndInstructions(failure as ToolCallResult<InputType, never>, options),
  );

  return { type: 'text', value: lines.join('\n') };
}

/**
 * Creates a toModelOutput function that converts ToolCallResult to a model-consumable format.
 *
 * This is a builder function that takes renderers for output and failure cases
 * and produces a function compatible with AI SDK's toModelOutput.
 *
 * @example
 * ```typescript
 * // Simple text renderer
 * const toModelOutput = createToModelOutput<Input, Output>({
 *   renderOutput: (output) => ({ type: 'text', value: `Result: ${output.name}` }),
 * });
 *
 * // With multipart content including images
 * const toModelOutput = createToModelOutput<Input, Output>({
 *   renderOutput: (output) => ({
 *     type: 'content',
 *     value: [
 *       { type: 'text', text: `Found: ${output.name}` },
 *       { type: 'media', data: output.imageBase64, mediaType: 'image/png' },
 *     ],
 *   }),
 * });
 * ```
 */
export function createToModelOutput<InputType, OutputType>(
  options: CreateToModelOutputOptions<InputType, OutputType> = {},
): (output: ToolCallResult<InputType, OutputType>) => ModelOutput {
  const {
    renderOutput,
    renderFailure,
    includeFeedback = true,
    includeInstructions = true,
  } = options;

  return (result: ToolCallResult<InputType, OutputType>): ModelOutput => {
    if (result.ok) {
      // Success case
      const outputValue = extractOutputValue(result);

      if (renderOutput && outputValue !== undefined) {
        const rendered = renderOutput(outputValue);

        // If feedback/instructions are enabled, append them for text outputs
        if (
          (includeFeedback || includeInstructions) &&
          (result.feedback?.length || result.instructions?.length)
        ) {
          const feedbackLines = formatFeedbackAndInstructions(result, {
            includeFeedback,
            includeInstructions,
          });

          if (feedbackLines.length > 0) {
            if (rendered.type === 'text') {
              return {
                type: 'text',
                value: rendered.value + '\n\n' + feedbackLines.join('\n'),
              };
            }
            if (rendered.type === 'content') {
              return {
                type: 'content',
                value: [...rendered.value, { type: 'text', text: '\n' + feedbackLines.join('\n') }],
              };
            }
          }
        }

        return rendered;
      }

      // Default: JSON representation for success
      return { type: 'json', value: result as unknown };
    } else {
      // Failure case
      if (renderFailure) {
        return renderFailure(result);
      }

      return defaultFailureRenderer(result, { includeFeedback, includeInstructions });
    }
  };
}

/**
 * Creates a simple text-based toModelOutput function.
 * Converts the entire ToolCallResult to a formatted text string.
 *
 * This is useful when you want to replace JSON representation with plain text.
 *
 * @example
 * ```typescript
 * const tool = tool2agent({
 *   // ...
 *   toModelOutput: createTextToModelOutput(),
 * });
 * ```
 */
export function createTextToModelOutput<InputType, OutputType>(options?: {
  /**
   * Custom formatter for the output value.
   * Default uses JSON.stringify with formatting.
   */
  formatOutput?: (output: OutputType) => string;
  includeFeedback?: boolean;
  includeInstructions?: boolean;
}): (output: ToolCallResult<InputType, OutputType>) => ModelOutput {
  const formatOutput = options?.formatOutput ?? ((o: OutputType) => JSON.stringify(o, null, 2));

  return createToModelOutput<InputType, OutputType>({
    renderOutput: output => ({ type: 'text', value: formatOutput(output) }),
    includeFeedback: options?.includeFeedback,
    includeInstructions: options?.includeInstructions,
  });
}

/**
 * Pre-built renderer that formats output as YAML-like text.
 * This is a simple implementation that works for basic objects.
 *
 * @example
 * ```typescript
 * const tool = tool2agent({
 *   // ...
 *   toModelOutput: createTextToModelOutput({
 *     formatOutput: yamlLikeFormatter,
 *   }),
 * });
 * ```
 */
export function yamlLikeFormatter(value: unknown, indent = 0): string {
  const prefix = '  '.repeat(indent);

  if (value === null || value === undefined) {
    return `${prefix}null`;
  }

  if (typeof value === 'string') {
    // Multi-line strings use block scalar
    if (value.includes('\n')) {
      return `${prefix}|\n${value
        .split('\n')
        .map(line => `${prefix}  ${line}`)
        .join('\n')}`;
    }
    return `${prefix}${value}`;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${prefix}${value}`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${prefix}[]`;
    }
    return value.map(item => `${prefix}- ${yamlLikeFormatter(item, 0).trim()}`).join('\n');
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return `${prefix}{}`;
    }
    return entries
      .map(([key, val]) => {
        const formattedVal = yamlLikeFormatter(val, indent + 1);
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          return `${prefix}${key}:\n${formattedVal}`;
        }
        return `${prefix}${key}: ${formattedVal.trim()}`;
      })
      .join('\n');
  }

  // Fallback for any other types (symbols, functions, etc.)
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return `${prefix}${String(value)}`;
}
