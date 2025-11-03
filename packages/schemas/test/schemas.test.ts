import test from 'node:test';
import assert from 'node:assert/strict';
import { z, type ZodType } from 'zod';

import {
  mkFreeFormFeedbackSchema,
  mkAcceptableValuesSchema,
  mkParameterFeedbackRefusalSchema,
  mkParameterFeedbackSchema,
  mkValidationResultsSchema,
  mkToolCallAcceptedSchema,
  mkToolCallRejectedSchema,
  mkToolCallResultSchema,
  mkTool2AgentSchema,
  mkSingleParameterFeedbackSchema,
} from '../src/index.js';
import { nonEmptyArray } from '../src/schema-tools.js';

// Helper to create key enum using z.keyof() (Zod v4+)
function createKeyEnum(inputSchema: z.ZodObject<any>): z.ZodEnum<any> | null {
  const keys = Object.keys(inputSchema.shape);
  if (keys.length === 0) return null;
  return z.keyof(inputSchema) as z.ZodEnum<any>;
}

const expectParseOK = <T>(schema: ZodType<T>, value: unknown): void => {
  assert.doesNotThrow(() => schema.parse(value));
};

const expectParseFail = <T>(schema: ZodType<T>, value: unknown): void => {
  assert.throws(() => schema.parse(value));
};

// Base input/output schemas
const inputSchema = z.object({
  name: z.string(),
  age: z.number().int(),
  email: z.string().email().optional(),
});

const outputSchema = z.object({ id: z.string(), createdAt: z.string() });

// Quick smoke test
const toolCallResultSchema = mkTool2AgentSchema(inputSchema, outputSchema);
type ToolCallResultType = z.infer<typeof toolCallResultSchema>;
const toolCallResult: ToolCallResultType = {
  ok: true,
  id: '1',
  createdAt: 'now',
};
expectParseOK(toolCallResultSchema, toolCallResult);

test('helper functions', async t => {
  await t.test('nonEmptyArray - positive and negative', () => {
    const ne = nonEmptyArray(z.string());
    expectParseOK(ne, ['a']);
    expectParseOK(ne, ['a', 'b']);
    expectParseFail(ne, []);
  });
});

test('basic schema builders', async t => {
  await t.test('mkFreeFormFeedbackSchema', () => {
    const s = mkFreeFormFeedbackSchema();
    expectParseOK(s, {});
    expectParseOK(s, { feedback: ['x'] });
    expectParseOK(s, { instructions: ['do Y'] });
    expectParseFail(s, { feedback: [] });
    expectParseFail(s, { instructions: [] });
  });

  await t.test('mkAcceptableValuesSchema (AtMostOne)', () => {
    const s = mkAcceptableValuesSchema(z.string());
    expectParseOK(s, {});
    expectParseOK(s, { allowedValues: [] });
    expectParseOK(s, { allowedValues: ['a', 'b'] });
    expectParseOK(s, { suggestedValues: ['a'] });
    expectParseFail(s, { allowedValues: ['a'], suggestedValues: ['b'] });
  });
});

test('parameter feedback schemas', async t => {
  await t.test('mkParameterFeedbackRefusalSchema (AtLeastOne of reasons/required)', () => {
    const keyEnum = createKeyEnum(inputSchema);
    const s = mkParameterFeedbackRefusalSchema(keyEnum);
    expectParseOK(s, { problems: ['bad format'] });
    expectParseOK(s, { requiresValidParameters: ['name'] });
    expectParseOK(s, { problems: ['x'], requiresValidParameters: ['age'] });
    expectParseFail(s, {});
    expectParseFail(s, { problems: [] });
    expectParseFail(s, { requiresValidParameters: [] });
  });

  await t.test(
    'mkParameterFeedbackRefusalSchema - requiresValidParameters only accepts valid keys',
    () => {
      const keyEnum = createKeyEnum(inputSchema);
      const s = mkParameterFeedbackRefusalSchema(keyEnum);
      // Valid keys from inputSchema
      expectParseOK(s, { requiresValidParameters: ['name'] });
      expectParseOK(s, { requiresValidParameters: ['age'] });
      expectParseOK(s, { requiresValidParameters: ['email'] });
      expectParseOK(s, { requiresValidParameters: ['name', 'age'] });
      // Invalid keys should be rejected
      expectParseFail(s, { requiresValidParameters: ['invalidKey'] });
      expectParseFail(s, { requiresValidParameters: ['name', 'invalidKey'] });
      expectParseFail(s, { requiresValidParameters: ['unknown'] });
    },
  );

  await t.test('mkParameterFeedbackSchema valid and invalid branches', () => {
    const keyEnum = createKeyEnum(inputSchema);
    const namePf = mkParameterFeedbackSchema<z.infer<typeof inputSchema>, string, 'name'>(
      inputSchema.shape.name,
      keyEnum,
    );

    // valid: true branches
    expectParseOK(namePf, { valid: true });
    expectParseOK(namePf, {
      valid: true,
      normalizedValue: 'John',
      feedback: ['ok'],
      allowedValues: ['John', 'Jane'],
    });
    expectParseOK(namePf, {
      valid: true,
      suggestedValues: ['John', 'Jane'],
    });
    expectParseOK(namePf, {
      valid: true,
      normalizedValue: 'John',
      instructions: ['good'],
    });

    // valid: false branches with problems
    expectParseOK(namePf, { valid: false, problems: ['too short'] });
    expectParseOK(namePf, {
      valid: false,
      problems: ['bad'],
      allowedValues: ['John'],
    });
    expectParseOK(namePf, {
      valid: false,
      problems: ['bad'],
      suggestedValues: ['John'],
    });

    // valid: false branches with requiresValidParameters
    expectParseOK(namePf, { valid: false, requiresValidParameters: ['age'] });
    expectParseOK(namePf, {
      valid: false,
      requiresValidParameters: ['age'],
      allowedValues: ['John'],
    });
    expectParseOK(namePf, {
      valid: false,
      requiresValidParameters: ['age'],
      suggestedValues: ['John'],
    });

    // valid: false branches with both refusal fields
    expectParseOK(namePf, {
      valid: false,
      problems: ['bad'],
      requiresValidParameters: ['age'],
    });
    expectParseOK(namePf, {
      valid: false,
      problems: ['bad'],
      requiresValidParameters: ['age'],
      allowedValues: ['John'],
    });
    expectParseOK(namePf, {
      valid: false,
      problems: ['bad'],
      requiresValidParameters: ['age'],
      suggestedValues: ['John'],
    });

    // Negative tests
    expectParseFail(namePf, { valid: false }); // requires at least one refusal field
    // AtMostOne on acceptable values
    expectParseFail(namePf, {
      valid: true,
      allowedValues: ['x'],
      suggestedValues: ['y'],
    });
    expectParseFail(namePf, {
      valid: false,
      problems: ['bad'],
      allowedValues: ['x'],
      suggestedValues: ['y'],
    });
    // requiresValidParameters only accepts valid keys
    expectParseFail(namePf, {
      valid: false,
      requiresValidParameters: ['invalidKey'],
    });
    expectParseFail(namePf, {
      valid: false,
      requiresValidParameters: ['name', 'invalidKey'],
    });
    expectParseFail(namePf, {
      valid: false,
      problems: ['bad'],
      requiresValidParameters: ['unknown'],
    });
  });

  await t.test('mkSingleParameterFeedbackSchema - comprehensive coverage', () => {
    const stringInputSchema = z.string();
    const singlePfSchema = mkSingleParameterFeedbackSchema(stringInputSchema);
    type SinglePfType = z.infer<typeof singlePfSchema>;

    // Required field: problems
    expectParseOK(singlePfSchema, {
      problems: ['Invalid format'],
    });

    // With normalizedValue
    expectParseOK(singlePfSchema, {
      problems: ['Invalid'],
      normalizedValue: 'normalized',
    });

    // With dynamicParameterSchema
    expectParseOK(singlePfSchema, {
      problems: ['Invalid'],
      dynamicParameterSchema: { some: 'schema' },
    });

    // With feedback
    expectParseOK(singlePfSchema, {
      problems: ['Invalid'],
      feedback: ['Please correct'],
    });

    // With instructions
    expectParseOK(singlePfSchema, {
      problems: ['Invalid'],
      instructions: ['Follow these steps'],
    });

    // With allowedValues (empty array is valid)
    expectParseOK(singlePfSchema, {
      problems: ['Invalid'],
      allowedValues: [],
    });

    // With allowedValues (non-empty)
    expectParseOK(singlePfSchema, {
      problems: ['Invalid'],
      allowedValues: ['valid1', 'valid2'],
    });

    // With suggestedValues
    expectParseOK(singlePfSchema, {
      problems: ['Invalid'],
      suggestedValues: ['valid1', 'valid2'],
    });

    // All optional fields combined
    expectParseOK(singlePfSchema, {
      problems: ['Invalid format'],
      normalizedValue: 'normalized',
      dynamicParameterSchema: { some: 'schema' },
      feedback: ['Feedback'],
      instructions: ['Instructions'],
      allowedValues: ['valid1'],
    });

    // Another combination with suggestedValues
    expectParseOK(singlePfSchema, {
      problems: ['Invalid'],
      normalizedValue: 'normalized',
      dynamicParameterSchema: { some: 'schema' },
      feedback: ['Feedback'],
      instructions: ['Instructions'],
      suggestedValues: ['valid1', 'valid2'],
    });

    // None of allowedValues/suggestedValues (empty AcceptableValues - valid per AtMostOne)
    expectParseOK(singlePfSchema, {
      problems: ['Invalid'],
      normalizedValue: 'normalized',
      dynamicParameterSchema: { some: 'schema' },
      feedback: ['Feedback'],
      instructions: ['Instructions'],
    });

    // Negative: missing problems (required)
    expectParseFail(singlePfSchema, {
      normalizedValue: 'normalized',
    });

    // Negative: both allowedValues and suggestedValues (AtMostOne violation)
    expectParseFail(singlePfSchema, {
      problems: ['Invalid'],
      allowedValues: ['a'],
      suggestedValues: ['b'],
    });

    // Negative: empty problems array
    expectParseFail(singlePfSchema, {
      problems: [],
    });

    // Negative: empty feedback array
    expectParseFail(singlePfSchema, {
      problems: ['Invalid'],
      feedback: [],
    });

    // Negative: empty instructions array
    expectParseFail(singlePfSchema, {
      problems: ['Invalid'],
      instructions: [],
    });

    // Negative: empty suggestedValues array
    expectParseFail(singlePfSchema, {
      problems: ['Invalid'],
      suggestedValues: [],
    });
  });
});

test('validation results schemas', async t => {
  await t.test('mkValidationResultsSchema with specific keys only and non-empty', () => {
    const keyEnum = createKeyEnum(inputSchema);
    const vr = mkValidationResultsSchema(inputSchema, keyEnum);
    // at least one key present - need full ParameterFeedback structure
    expectParseOK(vr, {
      name: {
        valid: true,
        normalizedValue: 'John',
      },
    });
    expectParseOK(vr, {
      age: {
        valid: false,
        problems: ['neg'],
      },
    });
    expectParseOK(vr, {
      email: {
        valid: false,
        requiresValidParameters: ['name'],
      },
    });
    expectParseOK(vr, {
      name: {
        valid: false,
        problems: ['bad'],
        requiresValidParameters: ['age'],
      },
    });
    // Can have multiple keys (other keys are optional in branches)
    expectParseOK(vr, {
      name: { valid: true },
      age: { valid: true },
    });
    expectParseOK(vr, {
      name: { valid: false, problems: ['bad'] },
      age: { valid: false, requiresValidParameters: ['email'] },
    });
    // empty object not allowed (no branches match AtLeastOne)
    expectParseFail(vr, {});
  });
});

test('tool call schemas', async t => {
  await t.test('mkToolCallAcceptedSchema', () => {
    const acc = mkToolCallAcceptedSchema(outputSchema);
    // Objects with keys are merged directly (no value wrapper)
    expectParseOK(acc, { ok: true, id: '1', createdAt: 'now' });
    expectParseOK(acc, {
      ok: true,
      id: '1',
      createdAt: 'now',
      feedback: ['done'],
    });
    expectParseFail(acc, { ok: true });
    expectParseFail(acc, { ok: true, id: '1' });
    expectParseFail(acc, { ok: true, id: '1', createdAt: 'now', feedback: [] });
  });

  await t.test('mkToolCallAcceptedSchema with z.never() - value field omitted', () => {
    const accNever = mkToolCallAcceptedSchema(z.never());
    // Should accept objects without value field
    expectParseOK(accNever, { ok: true });
    expectParseOK(accNever, { ok: true, feedback: ['done'] });
    expectParseOK(accNever, { ok: true, instructions: ['do something'] });
    expectParseOK(accNever, { ok: true, feedback: ['done'], instructions: ['do something'] });
    // Should reject objects with value field (strict schema doesn't allow extra fields)
    expectParseFail(accNever, { ok: true, value: { id: '1' } });
    expectParseFail(accNever, { ok: true, value: null });
    expectParseFail(accNever, { ok: true, value: 'anything' });
    expectParseFail(accNever, { ok: true, value: 123 });
    expectParseFail(accNever, { ok: true, value: [] });
    expectParseFail(accNever, { ok: true, value: undefined });
  });

  await t.test('mkToolCallAcceptedSchema with z.object({}) - value field omitted', () => {
    const accEmpty = mkToolCallAcceptedSchema(z.object({}));
    // Should accept objects without value field (same as z.never())
    expectParseOK(accEmpty, { ok: true });
    expectParseOK(accEmpty, { ok: true, feedback: ['done'] });
    expectParseOK(accEmpty, { ok: true, instructions: ['do something'] });
    expectParseOK(accEmpty, { ok: true, feedback: ['done'], instructions: ['do something'] });
    // Should reject objects with value field (strict schema doesn't allow extra fields)
    expectParseFail(accEmpty, { ok: true, value: { id: '1' } });
    expectParseFail(accEmpty, { ok: true, value: null });
    expectParseFail(accEmpty, { ok: true, value: 'anything' });
    expectParseFail(accEmpty, { ok: true, value: 123 });
    expectParseFail(accEmpty, { ok: true, value: [] });
    expectParseFail(accEmpty, { ok: true, value: {} });
    expectParseFail(accEmpty, { ok: true, value: undefined });
  });

  await t.test('mkToolCallAcceptedSchema with object with keys - keys merged directly', () => {
    const accWithKeys = mkToolCallAcceptedSchema(outputSchema);
    // Should accept objects with keys merged directly (no value wrapper)
    expectParseOK(accWithKeys, { ok: true, id: '1', createdAt: 'now' });
    expectParseOK(accWithKeys, {
      ok: true,
      id: '1',
      createdAt: 'now',
      feedback: ['done'],
    });
    expectParseOK(accWithKeys, {
      ok: true,
      id: '1',
      createdAt: 'now',
      instructions: ['do something'],
    });
    // Should reject objects without required keys
    expectParseFail(accWithKeys, { ok: true });
    expectParseFail(accWithKeys, { ok: true, id: '1' });
    expectParseFail(accWithKeys, { ok: true, createdAt: 'now' });
    // Should reject objects with value field (keys should be at top level)
    expectParseFail(accWithKeys, { ok: true, value: { id: '1', createdAt: 'now' } });
    // Should reject objects with invalid keys
    expectParseFail(accWithKeys, { ok: true, id: '1', createdAt: 'now', feedback: [] });
  });

  await t.test('mkToolCallRejectedSchema', () => {
    const keyEnum = createKeyEnum(inputSchema);
    const vr = mkValidationResultsSchema(inputSchema, keyEnum);
    const rej = mkToolCallRejectedSchema(vr);

    // valid with validationResults - need full ParameterFeedback structure
    expectParseOK(rej, {
      ok: false,
      validationResults: {
        name: { valid: true, normalizedValue: 'John' },
      },
    });
    expectParseOK(rej, {
      ok: false,
      validationResults: {
        name: { valid: false, problems: ['bad'] },
      },
    });
    expectParseOK(rej, {
      ok: false,
      validationResults: {
        name: { valid: false, requiresValidParameters: ['age'] },
      },
    });
    expectParseOK(rej, {
      ok: false,
      validationResults: {
        name: { valid: false, problems: ['bad'], requiresValidParameters: ['age'] },
      },
    });
    // valid with problems
    expectParseOK(rej, { ok: false, problems: ['system down'] });
    // valid with both
    expectParseOK(rej, {
      ok: false,
      validationResults: { name: { valid: true } },
      problems: ['also rejected'],
    });
    expectParseOK(rej, {
      ok: false,
      validationResults: {
        name: { valid: false, problems: ['bad'] },
      },
      problems: ['also rejected'],
    });
    // invalid: neither provided
    expectParseFail(rej, { ok: false });
    // invalid: empty problems
    expectParseFail(rej, { ok: false, problems: [] });
  });

  await t.test('mkToolCallResultSchema union', () => {
    const acc = mkToolCallAcceptedSchema(outputSchema);
    const keyEnum = createKeyEnum(inputSchema);
    const vr = mkValidationResultsSchema(inputSchema, keyEnum);
    const rej = mkToolCallRejectedSchema(vr);
    const res = mkToolCallResultSchema(acc, rej);

    expectParseOK(res, { ok: true, id: '1', createdAt: 'now' });
    expectParseOK(res, { ok: false, problems: ['x'] });
    expectParseFail(res, { ok: true });
  });
});

test('end-to-end integration', async t => {
  await t.test('mkTool2AgentSchema end-to-end', () => {
    const toolSchema = mkTool2AgentSchema(inputSchema, outputSchema);

    // accepted branch
    expectParseOK(toolSchema, { ok: true, id: '1', createdAt: 'now' });

    // rejected: validationResults with various refusal combinations
    expectParseOK(toolSchema, {
      ok: false,
      validationResults: {
        name: { valid: false, problems: ['bad'] },
      },
    });
    expectParseOK(toolSchema, {
      ok: false,
      validationResults: {
        name: { valid: false, requiresValidParameters: ['age'] },
      },
    });
    expectParseOK(toolSchema, {
      ok: false,
      validationResults: {
        name: { valid: false, problems: ['bad'], requiresValidParameters: ['age'] },
      },
    });
    expectParseOK(toolSchema, {
      ok: false,
      validationResults: {
        name: { valid: false, problems: ['bad'], allowedValues: ['John'] },
      },
    });
    expectParseOK(toolSchema, {
      ok: false,
      validationResults: {
        name: { valid: false, requiresValidParameters: ['age'], suggestedValues: ['John'] },
      },
    });

    // rejected: problems
    expectParseOK(toolSchema, { ok: false, problems: ['rate limit'] });

    // rejected: both
    expectParseOK(toolSchema, {
      ok: false,
      validationResults: { name: { valid: true } },
      problems: ['also rejected'],
    });
    expectParseOK(toolSchema, {
      ok: false,
      validationResults: {
        name: { valid: false, problems: ['bad'], requiresValidParameters: ['age'] },
      },
      problems: ['also rejected'],
    });

    // negatives
    expectParseFail(toolSchema, { ok: false });
    expectParseFail(toolSchema, { ok: true });
  });
});

test('type inference tests', async t => {
  await t.test('ToolCallAccepted with type inference', () => {
    const acceptedSchema = mkToolCallAcceptedSchema(outputSchema);
    type AcceptedType = z.infer<typeof acceptedSchema>;

    const accepted: AcceptedType = {
      ok: true,
      id: 'test-id',
      createdAt: '2024-01-01',
      feedback: ['Success'],
      instructions: ['Follow up'],
    };

    expectParseOK(acceptedSchema, accepted);

    // Negative: typed value violating schema constraints
    const invalidAcceptedTyped: AcceptedType = {
      ok: true,
      id: 'test-id',
      createdAt: '2024-01-01',
      // @ts-expect-error - Empty array violates NonEmptyArray constraint
      feedback: [], // Empty array violates NonEmptyArray constraint
    };

    expectParseFail(acceptedSchema, invalidAcceptedTyped);
  });

  await t.test('ToolCallRejected with type inference', () => {
    const keyEnum = createKeyEnum(inputSchema);
    const vrSchema = mkValidationResultsSchema(inputSchema, keyEnum);
    const rejectedSchema = mkToolCallRejectedSchema(vrSchema);
    type RejectedType = z.infer<typeof rejectedSchema>;

    const rejectedWithValidation: RejectedType = {
      ok: false,
      validationResults: {
        name: { valid: false, problems: ['Invalid format'] },
        age: { valid: true },
      },
      feedback: ['Please correct the errors'],
    };

    expectParseOK(rejectedSchema, rejectedWithValidation);

    const rejectedWithReasons: RejectedType = {
      ok: false,
      problems: ['Rate limit exceeded', 'Service unavailable'],
      instructions: ['Try again later'],
    };

    expectParseOK(rejectedSchema, rejectedWithReasons);

    // Negative: typed value violating AtLeastOne constraint
    // @ts-expect-error - Missing both validationResults and problems
    const invalidRejected: RejectedType = {
      ok: false,
      // Missing both validationResults and problems
    };

    expectParseFail(rejectedSchema, invalidRejected);
  });

  await t.test('ParameterFeedback with type inference', () => {
    const keyEnum = createKeyEnum(inputSchema);
    const paramSchema = mkParameterFeedbackSchema<z.infer<typeof inputSchema>, string, 'name'>(
      inputSchema.shape.name,
      keyEnum,
    );
    type ParamFeedbackType = z.infer<typeof paramSchema>;

    const validParam: ParamFeedbackType = {
      valid: true,
      normalizedValue: 'John Doe',
      allowedValues: ['John Doe', 'Jane Doe'],
      feedback: ['Value normalized'],
    };

    expectParseOK(paramSchema, validParam);

    const invalidParam: ParamFeedbackType = {
      valid: false,
      problems: ['Too short', 'Invalid characters'],
      requiresValidParameters: ['email'],
      suggestedValues: ['John', 'Johnny'],
    };

    expectParseOK(paramSchema, invalidParam);

    // Negative: typed value violating AtMostOne constraint
    // @ts-expect-error - Both allowedValues and suggestedValues violates AtMostOne
    const invalidBothValues: ParamFeedbackType = {
      valid: true,
      allowedValues: ['a'],
      suggestedValues: ['b'], // Violates AtMostOne
    };

    expectParseFail(paramSchema, invalidBothValues);
  });

  await t.test('ValidationResults with type inference', () => {
    const keyEnum = createKeyEnum(inputSchema);
    const vrSchema = mkValidationResultsSchema<z.infer<typeof inputSchema>>(inputSchema, keyEnum);
    type ValidationResultsType = z.infer<typeof vrSchema>;

    const singleParam: ValidationResultsType = {
      name: {
        valid: false,
        problems: ['Invalid'],
        requiresValidParameters: ['age'],
      },
    };

    expectParseOK(vrSchema, singleParam);

    const multipleParams: ValidationResultsType = {
      name: { valid: true, normalizedValue: 'John' },
      age: { valid: false, problems: ['Must be positive'] },
      email: { valid: true },
    };

    expectParseOK(vrSchema, multipleParams);

    // Negative: empty object violates AtLeastOne (runtime constraint, not type-level)
    const emptyValidation: Record<string, never> = {};
    const emptyValidationTyped = emptyValidation as ValidationResultsType;
    expectParseFail(vrSchema, emptyValidationTyped);
  });

  await t.test('empty input schema', () => {
    const emptyInputSchema = z.object({});
    const emptyToolSchema = mkTool2AgentSchema(emptyInputSchema, outputSchema);
    type EmptyToolResultType = z.infer<typeof emptyToolSchema>;

    const accepted: EmptyToolResultType = {
      ok: true,
      id: '1',
      createdAt: 'now',
    };

    expectParseOK(emptyToolSchema, accepted);

    // Rejected with problems (empty input has no validationResults)
    const rejected: EmptyToolResultType = {
      ok: false,
      problems: ['No input provided'],
    } as EmptyToolResultType;

    expectParseOK(emptyToolSchema, rejected);

    // Empty validationResults is actually valid when input schema is empty
    // because atLeastOne constraint is satisfied by presence of validationResults field
    const rejectedWithEmptyValidation: EmptyToolResultType = {
      ok: false,
      validationResults: {},
    } as EmptyToolResultType;

    expectParseOK(emptyToolSchema, rejectedWithEmptyValidation);

    // Negative: missing both validationResults and problems
    // @ts-expect-error - Missing both validationResults and problems
    const invalidRejected: EmptyToolResultType = {
      ok: false,
      // Missing both required fields
    };

    expectParseFail(emptyToolSchema, invalidRejected);
  });

  await t.test('complex nested structures', () => {
    const complexInputSchema = z.object({
      user: z.object({ name: z.string(), age: z.number() }),
      settings: z.object({ theme: z.string(), notifications: z.boolean() }),
    });

    const complexOutputSchema = z.object({
      result: z.array(z.object({ id: z.string(), score: z.number() })),
      metadata: z.object({ timestamp: z.string(), version: z.string() }),
    });

    const complexToolSchema = mkTool2AgentSchema(complexInputSchema, complexOutputSchema);
    type ComplexToolResultType = z.infer<typeof complexToolSchema>;

    const complexAccepted: ComplexToolResultType = {
      ok: true,
      result: [
        { id: '1', score: 95 },
        { id: '2', score: 87 },
      ],
      metadata: { timestamp: '2024-01-01', version: '1.0' },
      feedback: ['Processing complete'],
    };

    expectParseOK(complexToolSchema, complexAccepted);

    const complexRejected: ComplexToolResultType = {
      ok: false,
      validationResults: {
        user: {
          valid: false,
          problems: ['Invalid user data'],
          requiresValidParameters: ['settings'],
        },
        settings: {
          valid: true,
          normalizedValue: { theme: 'dark', notifications: true },
        },
      },
      problems: ['Additional validation failed'],
    } as ComplexToolResultType;

    expectParseOK(complexToolSchema, complexRejected);

    // Negative: invalid nested structure
    const invalidComplexTyped: ComplexToolResultType = {
      ok: true,
      // @ts-expect-error - Missing required 'score' field in result array items
      result: [{ id: '1' }], // Missing required 'score' field
      metadata: { timestamp: '2024-01-01', version: '1.0' },
    };

    expectParseFail(complexToolSchema, invalidComplexTyped);
  });
});

test('non-record input types', async t => {
  await t.test('mkTool2AgentSchema with string input (non-record)', () => {
    const stringInputSchema = z.string();
    const stringOutputSchema = z.object({ result: z.string() });
    const stringToolSchema = mkTool2AgentSchema(stringInputSchema, stringOutputSchema);
    type StringToolResultType = z.infer<typeof stringToolSchema>;

    // Accepted: non-record outputs wrap in value field
    const accepted: StringToolResultType = {
      ok: true,
      result: 'success',
      feedback: ['Done'],
    };
    expectParseOK(stringToolSchema, accepted);

    // Rejected: SingleParameterFeedback - problems is required
    const rejectedWithProblems: StringToolResultType = {
      ok: false,
      problems: ['Invalid format'],
    };
    expectParseOK(stringToolSchema, rejectedWithProblems);

    // Rejected: with problems and other SingleParameterFeedback fields
    const rejectedWithMoreFields: StringToolResultType = {
      ok: false,
      problems: ['Input too long'],
      normalizedValue: 'normalized',
      suggestedValues: ['valid1', 'valid2'],
    };
    expectParseOK(stringToolSchema, rejectedWithMoreFields);

    // Rejected: with problems and allowedValues
    const rejectedWithAllowedValues: StringToolResultType = {
      ok: false,
      problems: ['Invalid'],
      allowedValues: ['valid1', 'valid2'],
    };
    expectParseOK(stringToolSchema, rejectedWithAllowedValues);

    // Negative: missing problems (required)
    expectParseFail(stringToolSchema, { ok: false });

    // Negative: both allowedValues and suggestedValues (AtMostOne violation)
    expectParseFail(stringToolSchema, {
      ok: false,
      problems: ['Invalid'],
      allowedValues: ['a'],
      suggestedValues: ['b'],
    });
  });

  await t.test('mkTool2AgentSchema with number input (non-record)', () => {
    const numberInputSchema = z.number();
    const numberOutputSchema = z.never();
    const numberToolSchema = mkTool2AgentSchema(numberInputSchema, numberOutputSchema);
    type NumberToolResultType = z.infer<typeof numberToolSchema>;

    // Accepted: never output has no value field
    const accepted: NumberToolResultType = {
      ok: true,
      feedback: ['Processed'],
    };
    expectParseOK(numberToolSchema, accepted);

    // Rejected: SingleParameterFeedback - problems is required
    const rejected: NumberToolResultType = {
      ok: false,
      problems: ['Number too large'],
      suggestedValues: [42, 100],
    };
    expectParseOK(numberToolSchema, rejected);
  });

  await t.test('mkTool2AgentSchema with array input (non-record)', () => {
    const arrayInputSchema = z.array(z.string());
    const arrayOutputSchema = z.number();
    const arrayToolSchema = mkTool2AgentSchema(arrayInputSchema, arrayOutputSchema);
    type ArrayToolResultType = z.infer<typeof arrayToolSchema>;

    // Accepted: non-object output wraps in value field
    const accepted: ArrayToolResultType = {
      ok: true,
      value: 42,
    };
    expectParseOK(arrayToolSchema, accepted);

    // Rejected: SingleParameterFeedback - problems is required
    const rejected: ArrayToolResultType = {
      ok: false,
      problems: ['Array too short'],
      allowedValues: [['a', 'b']],
    };
    expectParseOK(arrayToolSchema, rejected);
  });

  await t.test('mkTool2AgentSchema with union input (non-record)', () => {
    const unionInputSchema = z.union([z.string(), z.number()]);
    const unionOutputSchema = z.boolean();
    const unionToolSchema = mkTool2AgentSchema(unionInputSchema, unionOutputSchema);
    type UnionToolResultType = z.infer<typeof unionToolSchema>;

    // Accepted
    const accepted: UnionToolResultType = {
      ok: true,
      value: true,
    };
    expectParseOK(unionToolSchema, accepted);

    // Rejected: SingleParameterFeedback - problems is required
    const rejected: UnionToolResultType = {
      ok: false,
      problems: ['Invalid union value'],
    };
    expectParseOK(unionToolSchema, rejected);
  });

  await t.test('non-record input validation feedback structure', () => {
    const stringInputSchema = z.string();
    const stringToolSchema = mkTool2AgentSchema(stringInputSchema, z.string());
    type StringToolResultType = z.infer<typeof stringToolSchema>;

    // Valid feedback structure for non-record: SingleParameterFeedback directly
    const rejectedWithProblems: StringToolResultType = {
      ok: false,
      problems: ['Too short'],
      normalizedValue: 'normalized',
      feedback: ['Value normalized'],
    };
    expectParseOK(stringToolSchema, rejectedWithProblems);

    // Valid with allowedValues
    const rejectedWithAllowedValues: StringToolResultType = {
      ok: false,
      problems: ['Invalid'],
      allowedValues: ['valid1', 'valid2'],
    };
    expectParseOK(stringToolSchema, rejectedWithAllowedValues);

    // Valid with suggestedValues
    const rejectedWithSuggestedValues: StringToolResultType = {
      ok: false,
      problems: ['Invalid'],
      suggestedValues: ['valid1', 'valid2'],
    };
    expectParseOK(stringToolSchema, rejectedWithSuggestedValues);

    // Negative: missing problems (required)
    expectParseFail(stringToolSchema, {
      ok: false,
      normalizedValue: 'normalized',
    });

    // Negative: both allowedValues and suggestedValues (AtMostOne violation)
    expectParseFail(stringToolSchema, {
      ok: false,
      problems: ['Invalid'],
      allowedValues: ['a'],
      suggestedValues: ['b'],
    });
  });
});
