import { type ZodType, z, ZodNever, ZodObject } from 'zod';
import type {
  ToolCallResult,
  FeedbackAndInstructions,
  AcceptableValues,
  ParameterValidationResult,
  ToolCallSuccess,
  ToolCallFailure,
  ParameterValidationFailureReasons,
  ValueFailureFeedback,
} from '@tool2agent/types';
import {
  nonEmptyArray,
  atMostOne,
  atMostOneTagged,
  atLeastOne,
  atLeastOneTagged,
  tagObject,
  tagUnion,
  untag,
  intersectSchemas,
  getUnionBranches,
  type TaggedUnionSchema,
  type TaggedSchema,
} from './schema-tools.js';

// Trivial reusable schemas
const feedbackSchema = nonEmptyArray(z.string())
  .describe('Freeform feedback for the tool call. Cannot be empty.')
  .optional();

const instructionsSchema = nonEmptyArray(z.string())
  .describe('Freeform instructions for the agent in response to the tool call. Cannot be empty.')
  .optional();

const problemsSchema = nonEmptyArray(z.string()).describe(
  'Freeform reasons for why the parameter was not considered valid. Cannot be empty.',
);

const problemsRefusalSchema = nonEmptyArray(z.string()).describe(
  'Freeform reasons for why the parameter was not considered valid',
);

const problemsHighLevelSchema = nonEmptyArray(z.string()).describe(
  'High-level reasons why the tool call was rejected. Cannot be empty.',
);

const dynamicParameterSchema = z
  .unknown()
  .optional()
  .describe(
    'The tooling may dynamically validate the parameter based on the context. This is useful for parameters whose shape is not statically known at design time.',
  );

const normalizedValueDescription = 'The tooling may normalize values to a canonical form.';

const allowedValuesDescription =
  'Exhaustive list of acceptable values. Empty array indicates no options available.';

const suggestedValuesDescription = 'Non-exhaustive list of acceptable values. Cannot be empty.';

export function mkFeedbackAndInstructionsSchema(): z.ZodType<FeedbackAndInstructions> {
  return z
    .object({
      feedback: feedbackSchema,
      instructions: instructionsSchema,
    })
    .strict();
}

export function mkAcceptableValuesSchema<T extends ZodType<unknown>>(
  valueSchema: T,
): z.ZodType<AcceptableValues<z.infer<T>>> {
  return atMostOne({
    allowedValues: z.array(valueSchema).describe(allowedValuesDescription),
    suggestedValues: nonEmptyArray(valueSchema).describe(suggestedValuesDescription),
  }) as z.ZodType<AcceptableValues<z.infer<T>>>;
}

export function mkParameterValidationFailureReasonsSchema<
  InputType extends Record<string, unknown>,
>(
  paramKeyEnum: z.ZodEnum<Record<string, string>> | null,
): z.ZodType<ParameterValidationFailureReasons<InputType, keyof InputType>> {
  const branches: Record<string, ZodType<unknown>> = {
    problems: problemsRefusalSchema,
  };
  if (paramKeyEnum) {
    branches.requiresValidParameters = nonEmptyArray(paramKeyEnum).describe(
      'Parameters that must be valid before this parameter can be validated. Must be valid keys from the input schema.',
    );
  }
  return atLeastOne(branches) as z.ZodType<
    ParameterValidationFailureReasons<InputType, keyof InputType>
  >;
}

/**
 * Tagged version of mkParameterValidationFailureReasonsSchema
 */
function mkParameterValidationFailureReasonsSchemaTagged(
  paramKeyEnum: z.ZodEnum<Record<string, string>> | null,
): TaggedUnionSchema<
  z.ZodUnion<
    [
      z.ZodObject<Record<string, ZodType<unknown>>>,
      ...z.ZodObject<Record<string, ZodType<unknown>>>[],
    ]
  >
> {
  const branches: Record<string, ZodType<unknown>> = {
    problems: problemsRefusalSchema,
  };
  if (paramKeyEnum) {
    branches.requiresValidParameters = nonEmptyArray(paramKeyEnum).describe(
      'Parameters that must be valid before this parameter can be validated. Must be valid keys from the input schema.',
    );
  }
  return atLeastOneTagged(branches);
}

export function mkParameterValidationResultSchema<
  InputType extends Record<string, unknown>,
  ValueT,
  ParamKey extends keyof InputType = keyof InputType,
>(
  valueSchema: ZodType<ValueT> | undefined,
  paramKeyEnum: z.ZodEnum<Record<string, string>> | null,
): z.ZodType<ParameterValidationResult<InputType, ParamKey>> {
  const baseValueSchema = valueSchema ?? z.unknown();

  // Build common schema: normalizedValue, dynamicParameterSchema, feedback, instructions
  // Note: dynamicParameterSchema uses z.unknown() instead of z.custom() to enable JSON Schema conversion
  // The actual runtime value would be a ZodType, but at serialization time it's represented as unknown
  const commonSchema = z.object({
    normalizedValue: baseValueSchema.optional(),
    dynamicParameterSchema,
    feedback: feedbackSchema,
    instructions: instructionsSchema,
  });

  // Build AcceptableValues union schema (AtMostOne) - tagged
  const acceptableValuesSchemaTagged = atMostOneTagged({
    allowedValues: z.array(baseValueSchema).describe(allowedValuesDescription),
    suggestedValues: nonEmptyArray(baseValueSchema).describe(suggestedValuesDescription),
  });

  // Build ParameterValidationFailureReasons union schema (AtLeastOne) - tagged
  const refusalSchemaTagged = mkParameterValidationFailureReasonsSchemaTagged(paramKeyEnum);

  // Branch 1: valid: true
  // Intersect: { valid: true } & common & AcceptableValues union
  // First combine valid discriminator with common schema using extend
  const validTrueBase = tagObject(
    z
      .object({ valid: z.literal(true) })
      .extend(commonSchema.shape)
      .strict(),
  );
  const validTrueTagged = intersectSchemas(validTrueBase, acceptableValuesSchemaTagged);

  // Branch 2: valid: false
  // Intersect: { valid: false } & common & AcceptableValues union & ParameterValidationFailureReasons union
  // First combine valid discriminator with common schema using extend
  const validFalseBase = tagObject(
    z
      .object({ valid: z.literal(false) })
      .extend(commonSchema.shape)
      .strict(),
  );
  const validFalseWithAcceptableTagged = intersectSchemas(
    validFalseBase,
    acceptableValuesSchemaTagged,
  );
  // Now intersect with refusal schema
  const validFalseTagged = intersectSchemas(validFalseWithAcceptableTagged, refusalSchemaTagged);

  // Union of valid: true and valid: false branches
  // intersectSchemas may return an object or a union; normalize to union branches
  const validTrueBranches = getUnionBranches(
    validTrueTagged as TaggedSchema<
      | z.ZodObject<Record<string, ZodType<unknown>>>
      | z.ZodUnion<
          [
            z.ZodObject<Record<string, ZodType<unknown>>>,
            ...z.ZodObject<Record<string, ZodType<unknown>>>[],
          ]
        >
    >,
  );
  const validFalseBranches = getUnionBranches(
    validFalseTagged as TaggedSchema<
      | z.ZodObject<Record<string, ZodType<unknown>>>
      | z.ZodUnion<
          [
            z.ZodObject<Record<string, ZodType<unknown>>>,
            ...z.ZodObject<Record<string, ZodType<unknown>>>[],
          ]
        >
    >,
  );
  return z.union([...validTrueBranches, ...validFalseBranches] as [
    z.ZodObject<Record<string, ZodType<unknown>>>,
    z.ZodObject<Record<string, ZodType<unknown>>>,
    ...z.ZodObject<Record<string, ZodType<unknown>>>[],
  ]) as unknown as z.ZodType<ParameterValidationResult<InputType, ParamKey>>;
}

/**
 * Creates a Zod schema for ValueFailureFeedback.
 * Used for non-record input types where feedback is provided for the entire input value.
 */
export function mkValueFailureFeedbackSchema<InputType>(
  inputSchema: ZodType<InputType>,
): z.ZodType<ValueFailureFeedback<InputType>> {
  // Build common schema: normalizedValue, dynamicParameterSchema, feedback, instructions
  const commonSchema = z.object({
    normalizedValue: inputSchema.optional().describe(normalizedValueDescription),
    dynamicParameterSchema,
    feedback: feedbackSchema,
    instructions: instructionsSchema,
  });

  // Build AcceptableValues union schema (AtMostOne) - tagged
  const acceptableValuesSchemaTagged = atMostOneTagged({
    allowedValues: z.array(inputSchema).describe(allowedValuesDescription),
    suggestedValues: nonEmptyArray(inputSchema).describe(suggestedValuesDescription),
  });

  // Build base schema with problems field
  const problemsSchemaTagged = tagObject(
    z
      .object({
        problems: problemsSchema,
      })
      .extend(commonSchema.shape)
      .strict(),
  );

  // Intersect: problems & common & AcceptableValues union
  const resultTagged = intersectSchemas(problemsSchemaTagged, acceptableValuesSchemaTagged);

  // Extract the final schema (result is always a union from intersectSchemas)
  return untag(resultTagged) as z.ZodType<ValueFailureFeedback<InputType>>;
}

export function mkValidationResultsSchema<InputType extends Record<string, unknown>>(
  inputSchema: z.ZodObject<Record<string, ZodType<unknown>>>,
  paramKeyEnum: z.ZodEnum<Record<string, string>> | null,
): z.ZodType<{
  [K in keyof InputType & string]?: ParameterValidationResult<InputType, K>;
}> {
  const shape = inputSchema.shape;
  const keys = Object.keys(shape) as (keyof InputType & string)[];
  if (keys.length === 0)
    return z.object({}).strict() as unknown as z.ZodType<{
      [K in keyof InputType & string]?: ParameterValidationResult<InputType, K>;
    }>;
  const perKey: Partial<{
    [K in keyof InputType & string]: z.ZodType<ParameterValidationResult<InputType, K>>;
  }> = {};
  for (const key of keys) {
    const valueSchema = shape[key as string] as ZodType<InputType[typeof key]>;
    perKey[key] = mkParameterValidationResultSchema<InputType, InputType[typeof key], typeof key>(
      valueSchema,
      paramKeyEnum,
    ) as z.ZodType<ParameterValidationResult<InputType, typeof key>>;
  }
  return atLeastOne(
    perKey as {
      [K in keyof InputType & string]: z.ZodType<ParameterValidationResult<InputType, K>>;
    },
  ) as unknown as z.ZodType<{
    [K in keyof InputType & string]?: ParameterValidationResult<InputType, K>;
  }>;
}

export function mkToolCallSuccessSchema<OutputType>(
  outputSchema: ZodType<OutputType>,
): z.ZodType<ToolCallSuccess<OutputType>> {
  // Check if outputSchema is z.never() using instanceof.
  //
  // NOTE: There is a discrepancy between type-level and runtime checks:
  // - Type-level: ToolCallSuccess<OutputType> checks `OutputType extends never`
  //   which matches any schema TypeScript infers as `never`
  // - Runtime: We check `instanceof ZodNever` which only matches z.never()
  //
  // This means schemas like `z.union([])` or incompatible intersections may
  // type to `never` but won't be detected here. This is OK for us:
  // - z.never() is the explicit, idiomatic way to express "no output"
  // - Other schemas that happen to type to `never` indicate a bug in the schema
  // - The runtime check should match explicit intent, not type inference
  //
  // If you need "no output", use z.never() explicitly.
  const isNever = outputSchema instanceof ZodNever;
  const baseObject = {
    ok: z.literal(true),
    feedback: feedbackSchema,
    instructions: instructionsSchema,
  };

  // Check if outputSchema is a ZodObject
  const isObject = outputSchema instanceof ZodObject;
  const isEmptyObject = isObject && Object.keys(outputSchema.shape).length === 0;

  // Build the schema based on the output type:
  // 1. never -> no value field
  // 2. empty object (z.object({})) -> no value field
  // 3. object with keys -> merge keys directly (no value wrapper)
  // 4. otherwise -> wrap in value field
  if (isNever || isEmptyObject) {
    // No value field - return base object only
    return z.object(baseObject).strict() as unknown as z.ZodType<ToolCallSuccess<OutputType>>;
  } else if (isObject) {
    // Object with keys - merge the object's shape directly into the result
    return z
      .object({
        ...baseObject,
        ...outputSchema.shape,
      })
      .strict() as unknown as z.ZodType<ToolCallSuccess<OutputType>>;
  } else {
    // Other types - wrap in value field
    return z
      .object({
        ...baseObject,
        value: outputSchema,
      })
      .strict() as unknown as z.ZodType<ToolCallSuccess<OutputType>>;
  }
}

export function mkToolCallFailureSchema<InputType extends Record<string, unknown>>(
  validationResultsSchema: z.ZodType<
    | {
        [K in keyof InputType & string]?: ParameterValidationResult<InputType, K>;
      }
    | ParameterValidationResult<{ value: InputType }, 'value'>
  >,
): z.ZodType<ToolCallFailure<InputType>> {
  // Build common schema: ok: false & FeedbackAndInstructions
  const commonSchema = z
    .object({
      ok: z.literal(false),
      feedback: feedbackSchema,
      instructions: instructionsSchema,
    })
    .strict();

  // Build AtLeastOne union schema for validationResults/problems - tagged
  const atLeastOneSchemaTagged = atLeastOneTagged({
    validationResults: validationResultsSchema.describe(
      'Validation feedback for individual parameters. At least one parameter must be present.',
    ),
    problems: problemsHighLevelSchema,
  });

  // Intersect: common & AtLeastOne union
  const commonSchemaTagged = tagObject(commonSchema);
  const resultTagged = intersectSchemas(commonSchemaTagged, atLeastOneSchemaTagged);

  // Extract the final schema (result is always a union from intersectSchemas)
  return untag(resultTagged) as z.ZodType<ToolCallFailure<InputType>>;
}

export function mkToolCallResultSchema<InputType extends Record<string, unknown>, OutputT>(
  accepted: z.ZodType<ToolCallSuccess<OutputT>>,
  rejected: z.ZodType<ToolCallFailure<InputType>>,
): z.ZodType<ToolCallResult<InputType, OutputT>> {
  return z.union([accepted, rejected]) as z.ZodType<ToolCallResult<InputType, OutputT>>;
}

/**
 * Creates a Zod enum from object schema keys using z.keyof().
 * Requires Zod v4+.
 */
function createKeyEnum(
  inputSchema: z.ZodObject<Record<string, ZodType<unknown>>>,
  keys: string[],
): z.ZodEnum<Record<string, string>> | null {
  if (keys.length === 0) return null;
  return z.keyof(inputSchema) as z.ZodEnum<Record<string, string>>;
}

/**
 * Constructs a Zod schema for ToolCallResult that matches the TypeScript types
 * defined in tool2agent.ts.
 *
 * @param inputSchema - Zod schema for the tool input type (can be ZodObject for records or any ZodType for non-records)
 * @param outputSchema - Zod schema for the tool output type
 * @returns Zod schema for ToolCallResult<InputType, OutputType>
 */
export function mkTool2AgentSchema<S extends ZodType<unknown>, OutputType>(
  inputSchema: S,
  outputSchema: ZodType<OutputType>,
): ZodType<ToolCallResult<z.infer<S>, OutputType>> {
  type InputType = z.infer<S>;

  // Check if inputSchema is a ZodObject (record case)
  const isRecord = inputSchema instanceof ZodObject;

  const accepted = mkToolCallSuccessSchema<OutputType>(outputSchema);

  let rejected: z.ZodType<ToolCallFailure<InputType & Record<string, unknown>>>;

  if (isRecord) {
    // Record case: use field-based validation
    const shape = inputSchema.shape;
    const keys = Object.keys(shape);
    const paramKeyEnum = createKeyEnum(
      inputSchema as z.ZodObject<Record<string, ZodType<unknown>>>,
      keys,
    );
    const validationResults = mkValidationResultsSchema<InputType & Record<string, unknown>>(
      inputSchema as z.ZodObject<Record<string, ZodType<unknown>>>,
      paramKeyEnum,
    );
    rejected = mkToolCallFailureSchema<InputType & Record<string, unknown>>(validationResults);
  } else {
    // Non-record case: use ValueFailureFeedback directly
    // For non-records, FailureFeedback becomes ValueFailureFeedback<InputType>
    // ToolCallFailure<InputType> = { ok: false } & ValueFailureFeedback<InputType> & FeedbackAndInstructions
    // ValueFailureFeedback already includes feedback and instructions, so we just need to add ok: false
    const valueFailureFeedbackSchema = mkValueFailureFeedbackSchema<InputType>(
      inputSchema as ZodType<InputType>,
    );

    // mkValueFailureFeedbackSchema returns a union (from intersectSchemas), so we need to
    // intersect it with the ok: false field using tagged schemas
    const okSchema = tagObject(
      z
        .object({
          ok: z.literal(false),
        })
        .strict(),
    );

    // Wrap the union in a tagged schema for intersection
    // mkValueFailureFeedbackSchema always returns a union from intersectSchemas
    const valueFfTagged: TaggedSchema<any> = tagUnion(
      valueFailureFeedbackSchema as z.ZodUnion<any>,
      (valueFailureFeedbackSchema as z.ZodUnion<any>).options,
    );

    const rejectedTagged = intersectSchemas(okSchema, valueFfTagged);
    rejected = untag(rejectedTagged) as z.ZodType<
      ToolCallFailure<InputType & Record<string, unknown>>
    >;
  }

  return mkToolCallResultSchema<InputType & Record<string, unknown>, OutputType>(
    accepted,
    rejected,
  ) as ZodType<ToolCallResult<InputType, OutputType>>;
}
