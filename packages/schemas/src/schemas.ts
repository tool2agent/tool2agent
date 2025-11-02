import { type ZodType, z, ZodNever, ZodObject } from 'zod';
import type {
  ToolCallResult,
  FreeFormFeedback,
  AcceptableValues,
  ParameterFeedbackCommon,
  ParameterFeedbackVariants,
  ParameterFeedback,
  ToolCallAccepted,
  ToolCallRejected,
  ParameterFeedbackRefusal,
} from '@tool2agent/types';
import {
  nonEmptyArray,
  atMostOne,
  atMostOneTagged,
  atLeastOne,
  atLeastOneTagged,
  tagObject,
  untag,
  intersectSchemas,
  getUnionBranches,
  type TaggedUnionSchema,
  type TaggedSchema,
} from './schema-tools.js';

export function mkFreeFormFeedbackSchema(): z.ZodType<FreeFormFeedback> {
  return z
    .object({
      feedback: nonEmptyArray(z.string())
        .describe('Freeform feedback for the tool call. Cannot be empty.')
        .optional(),
      instructions: nonEmptyArray(z.string())
        .describe(
          'Freeform instructions for the agent in response to the tool call. Cannot be empty.',
        )
        .optional(),
    })
    .strict();
}

export function mkAcceptableValuesSchema<T extends ZodType<unknown>>(
  valueSchema: T,
): z.ZodType<AcceptableValues<z.infer<T>>> {
  return atMostOne({
    allowedValues: z
      .array(valueSchema)
      .describe(
        'Exhaustive list of acceptable values. Empty array indicates no options available.',
      ),
    suggestedValues: nonEmptyArray(valueSchema).describe(
      'Non-exhaustive list of acceptable values. Cannot be empty.',
    ),
  }) as z.ZodType<AcceptableValues<z.infer<T>>>;
}

export function mkParameterFeedbackRefusalSchema<InputType extends Record<string, unknown>>(
  paramKeyEnum: z.ZodEnum<Record<string, string>> | null,
): z.ZodType<ParameterFeedbackRefusal<InputType, keyof InputType>> {
  const branches: Record<string, ZodType<unknown>> = {
    refusalReasons: nonEmptyArray(z.string()).describe(
      'Freeform reasons for why the parameter was not considered valid',
    ),
  };
  if (paramKeyEnum) {
    branches.requiresValidParameters = nonEmptyArray(paramKeyEnum).describe(
      'Parameters that must be valid before this parameter can be validated. Must be valid keys from the input schema.',
    );
  }
  return atLeastOne(branches) as z.ZodType<ParameterFeedbackRefusal<InputType, keyof InputType>>;
}

/**
 * Tagged version of mkParameterFeedbackRefusalSchema
 */
function mkParameterFeedbackRefusalSchemaTagged(
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
    refusalReasons: nonEmptyArray(z.string()).describe(
      'Freeform reasons for why the parameter was not considered valid',
    ),
  };
  if (paramKeyEnum) {
    branches.requiresValidParameters = nonEmptyArray(paramKeyEnum).describe(
      'Parameters that must be valid before this parameter can be validated. Must be valid keys from the input schema.',
    );
  }
  return atLeastOneTagged(branches);
}

export function mkParameterFeedbackSchema<
  InputType extends Record<string, unknown>,
  ValueT,
  ParamKey extends keyof InputType = keyof InputType,
>(
  valueSchema: ZodType<ValueT> | undefined,
  paramKeyEnum: z.ZodEnum<Record<string, string>> | null,
): z.ZodType<ParameterFeedbackCommon<ValueT> & ParameterFeedbackVariants<InputType, ParamKey>> {
  const baseValueSchema = valueSchema ?? z.unknown();

  // Build common schema: normalizedValue, dynamicParameterSchema, feedback, instructions
  // Note: dynamicParameterSchema uses z.unknown() instead of z.custom() to enable JSON Schema conversion
  // The actual runtime value would be a ZodType, but at serialization time it's represented as unknown
  const commonSchema = z.object({
    normalizedValue: baseValueSchema.optional(),
    dynamicParameterSchema: z.unknown().optional(),
    feedback: nonEmptyArray(z.string())
      .describe('Freeform feedback for the tool call. Cannot be empty.')
      .optional(),
    instructions: nonEmptyArray(z.string())
      .describe(
        'Freeform instructions for the agent in response to the tool call. Cannot be empty.',
      )
      .optional(),
  });

  // Build AcceptableValues union schema (AtMostOne) - tagged
  const acceptableValuesSchemaTagged = atMostOneTagged({
    allowedValues: z
      .array(baseValueSchema)
      .describe(
        'Exhaustive list of acceptable values. Empty array indicates no options available.',
      ),
    suggestedValues: nonEmptyArray(baseValueSchema).describe(
      'Non-exhaustive list of acceptable values. Cannot be empty.',
    ),
  });

  // Build ParameterFeedbackRefusal union schema (AtLeastOne) - tagged
  const refusalSchemaTagged = mkParameterFeedbackRefusalSchemaTagged(paramKeyEnum);

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
  // Intersect: { valid: false } & common & AcceptableValues union & ParameterFeedbackRefusal union
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
  ]) as unknown as z.ZodType<
    ParameterFeedbackCommon<ValueT> & ParameterFeedbackVariants<InputType, ParamKey>
  >;
}

/**
 * Creates a validation results schema for non-record input types.
 * When InputType is not a record, it wraps it in { value: InputType }.
 */
function mkValidationResultsSchemaForNonRecord<InputType>(
  inputSchema: ZodType<InputType>,
): z.ZodType<ParameterFeedback<{ value: InputType }, 'value'>> {
  // Wrap the input in { value: ... } schema
  const wrappedSchema = z.object({ value: inputSchema });
  const paramKeyEnum = z.enum({ value: 'value' });

  return mkParameterFeedbackSchema<{ value: InputType }, InputType, 'value'>(
    inputSchema,
    paramKeyEnum,
  );
}

export function mkValidationResultsSchema<InputType extends Record<string, unknown>>(
  inputSchema: z.ZodObject<Record<string, ZodType<unknown>>>,
  paramKeyEnum: z.ZodEnum<Record<string, string>> | null,
): z.ZodType<{
  [K in keyof InputType & string]?: ParameterFeedback<InputType, K>;
}> {
  const shape = inputSchema.shape;
  const keys = Object.keys(shape) as (keyof InputType & string)[];
  if (keys.length === 0)
    return z.object({}).strict() as unknown as z.ZodType<{
      [K in keyof InputType & string]?: ParameterFeedback<InputType, K>;
    }>;
  const perKey: Partial<{
    [K in keyof InputType & string]: z.ZodType<ParameterFeedback<InputType, K>>;
  }> = {};
  for (const key of keys) {
    const valueSchema = shape[key as string] as ZodType<InputType[typeof key]>;
    perKey[key] = mkParameterFeedbackSchema<InputType, InputType[typeof key], typeof key>(
      valueSchema,
      paramKeyEnum,
    ) as z.ZodType<ParameterFeedback<InputType, typeof key>>;
  }
  return atLeastOne(
    perKey as {
      [K in keyof InputType & string]: z.ZodType<ParameterFeedback<InputType, K>>;
    },
  ) as unknown as z.ZodType<{
    [K in keyof InputType & string]?: ParameterFeedback<InputType, K>;
  }>;
}

export function mkToolCallAcceptedSchema<OutputType>(
  outputSchema: ZodType<OutputType>,
): z.ZodType<ToolCallAccepted<OutputType>> {
  // Check if outputSchema is z.never() using instanceof.
  //
  // NOTE: There is a discrepancy between type-level and runtime checks:
  // - Type-level: ToolCallAccepted<OutputType> checks `OutputType extends never`
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
    feedback: nonEmptyArray(z.string()).optional(),
    instructions: nonEmptyArray(z.string()).optional(),
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
    return z.object(baseObject).strict() as unknown as z.ZodType<ToolCallAccepted<OutputType>>;
  } else if (isObject) {
    // Object with keys - merge the object's shape directly into the result
    return z
      .object({
        ...baseObject,
        ...outputSchema.shape,
      })
      .strict() as unknown as z.ZodType<ToolCallAccepted<OutputType>>;
  } else {
    // Other types - wrap in value field
    return z
      .object({
        ...baseObject,
        value: outputSchema,
      })
      .strict() as unknown as z.ZodType<ToolCallAccepted<OutputType>>;
  }
}

export function mkToolCallRejectedSchema<InputType extends Record<string, unknown>>(
  validationResultsSchema: z.ZodType<
    | {
        [K in keyof InputType & string]?: ParameterFeedback<InputType, K>;
      }
    | ParameterFeedback<{ value: InputType }, 'value'>
  >,
): z.ZodType<ToolCallRejected<InputType>> {
  // Build common schema: ok: false & FreeFormFeedback
  const commonSchema = z
    .object({
      ok: z.literal(false),
      feedback: nonEmptyArray(z.string())
        .describe('Freeform feedback for the tool call. Cannot be empty.')
        .optional(),
      instructions: nonEmptyArray(z.string())
        .describe(
          'Freeform instructions for the agent in response to the tool call. Cannot be empty.',
        )
        .optional(),
    })
    .strict();

  // Build AtLeastOne union schema for validationResults/rejectionReasons - tagged
  const atLeastOneSchemaTagged = atLeastOneTagged({
    validationResults: validationResultsSchema.describe(
      'Validation feedback for individual parameters. At least one parameter must be present.',
    ),
    rejectionReasons: nonEmptyArray(z.string()).describe(
      'High-level reasons why the tool call was rejected. Cannot be empty.',
    ),
  });

  // Intersect: common & AtLeastOne union
  const commonSchemaTagged = tagObject(commonSchema);
  const resultTagged = intersectSchemas(commonSchemaTagged, atLeastOneSchemaTagged);

  // Extract the final schema (result is always a union from intersectSchemas)
  return untag(resultTagged) as z.ZodType<ToolCallRejected<InputType>>;
}

export function mkToolCallResultSchema<InputType extends Record<string, unknown>, OutputT>(
  accepted: z.ZodType<ToolCallAccepted<OutputT>>,
  rejected: z.ZodType<ToolCallRejected<InputType>>,
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

  let validationResults: z.ZodType<
    | {
        [K in keyof (InputType & Record<string, unknown>) & string]?: ParameterFeedback<
          InputType & Record<string, unknown>,
          K
        >;
      }
    | ParameterFeedback<{ value: InputType }, 'value'>
  >;

  if (isRecord) {
    // Record case: use field-based validation
    const shape = inputSchema.shape;
    const keys = Object.keys(shape);
    const paramKeyEnum = createKeyEnum(
      inputSchema as z.ZodObject<Record<string, ZodType<unknown>>>,
      keys,
    );
    validationResults = mkValidationResultsSchema<InputType & Record<string, unknown>>(
      inputSchema as z.ZodObject<Record<string, ZodType<unknown>>>,
      paramKeyEnum,
    );
  } else {
    // Non-record case: wrap in { value: InputType }
    validationResults = mkValidationResultsSchemaForNonRecord<InputType>(
      inputSchema as ZodType<InputType>,
    );
    // For non-records, TypedParametersFeedback expects validationResults to be wrapped
    // in AtLeastOne with rejectionReasons, but validationResults itself is just ParameterFeedback
    // We need to construct the proper schema structure
  }

  const accepted = mkToolCallAcceptedSchema<OutputType>(outputSchema);

  // For non-record case, we need to handle TypedParametersFeedback differently
  // It wraps validationResults in AtLeastOne with rejectionReasons
  let rejected: z.ZodType<ToolCallRejected<InputType & Record<string, unknown>>>;

  if (isRecord) {
    rejected = mkToolCallRejectedSchema<InputType & Record<string, unknown>>(validationResults);
  } else {
    // Non-record: TypedParametersFeedback wraps validationResults in AtLeastOne with rejectionReasons
    // validationResults is ParameterFeedback<{ value: InputType }, 'value'>
    const atLeastOneSchemaTagged = atLeastOneTagged({
      validationResults: validationResults.describe('Validation feedback for the input value.'),
      rejectionReasons: nonEmptyArray(z.string()).describe(
        'High-level reasons why the tool call was rejected. Cannot be empty.',
      ),
    });

    const commonSchema = z
      .object({
        ok: z.literal(false),
        feedback: nonEmptyArray(z.string())
          .describe('Freeform feedback for the tool call. Cannot be empty.')
          .optional(),
        instructions: nonEmptyArray(z.string())
          .describe(
            'Freeform instructions for the agent in response to the tool call. Cannot be empty.',
          )
          .optional(),
      })
      .strict();

    const commonSchemaTagged = tagObject(commonSchema);
    const resultTagged = intersectSchemas(commonSchemaTagged, atLeastOneSchemaTagged);
    rejected = untag(resultTagged) as z.ZodType<
      ToolCallRejected<InputType & Record<string, unknown>>
    >;
  }

  return mkToolCallResultSchema<InputType & Record<string, unknown>, OutputType>(
    accepted,
    rejected,
  ) as ZodType<ToolCallResult<InputType, OutputType>>;
}
