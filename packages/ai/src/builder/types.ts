import z from 'zod';
import {
  type ParameterValidationResult,
  type ToolCallResult,
  type NonEmptyArray,
} from '@tool2agent/types';
import { type Tool2Agent } from '../tool2agent.js';

/** Parameters for creating a tool builder.
 * @template InputSchema - The Zod schema for the tool's input (must be a schema of a record).
 * @template OutputSchema - The Zod schema for the tool's output. Can be z.never() for tools that do not return a value.
 * @template DynamicFields - The keys of InputSchema that are dynamic (allows the LLM to provide them incrementally).
 */
export type ToolBuilderParams<
  InputSchema extends z.ZodObject<z.ZodRawShape>,
  OutputSchema extends z.ZodTypeAny,
  DynamicFields extends keyof z.infer<InputSchema>,
> = {
  /** The Zod schema defining the tool's input structure. */
  inputSchema: InputSchema;
  /** The Zod schema defining the tool's output structure. */
  outputSchema: OutputSchema;
  /** Array of field names from InputSchema that are dynamic (will be made optional at runtime). */
  dynamicFields: readonly DynamicFields[];
  /** Optional description of the tool for the LLM. */
  description?: string;
  /** Function that executes the tool after all dynamic fields have passed validation.
   *
   * The input parameter is fully validated and matches the InputSchema (all required fields are present).
   *
   * Must return a {@link ToolCallResult} that indicates success or failure:
   * - Success: `{ ok: true, ...output }` where output matches OutputSchema (if OutputSchema is a record, spread it directly; otherwise use `{ value: output }`)
   * - Failure: `{ ok: false, validationResults: {...}, problems: [...], feedback: [...], instructions: [...], ... }` with structured feedback
   *
   * @param input - Fully validated input matching InputSchema.
   * @returns A Promise resolving to a ToolCallResult indicating success or failure with feedback.
   */
  execute: (
    input: z.infer<InputSchema>,
  ) => Promise<ToolCallResult<z.infer<InputSchema>, z.infer<OutputSchema>>>;
};

/** Creates a type where dynamic fields are optional and static fields remain required.
 *
 * This type is used internally by `toolBuilder` to represent the input type that the LLM can provide
 * incrementally. Dynamic fields are made optional, while static fields optionality is preserved.
 *
 * @template InputType - The full input type (typically inferred from a Zod schema).
 * @template DynamicFields - The keys of InputType that are dynamic (can be provided incrementally).
 *
 * @example
 * ```typescript
 * type Input = { name: string; age: number; email: string };
 * type Dynamic = DynamicInputType<Input, 'email'>;
 * // Result: { name: string; age: number; email?: string }
 * ```
 */
export type DynamicInputType<
  InputType extends Record<string, unknown>,
  DynamicFields extends keyof InputType,
> = {
  [FieldName in DynamicFields]?: InputType[FieldName];
} & {
  [FieldName in Exclude<keyof InputType, DynamicFields>]: InputType[FieldName];
};

/** Creates a type where dynamic fields are optional and static fields remain required, inferred from a Zod schema.
 *
 * @template InputSchema - The Zod object schema defining the input structure.
 * @template DynamicFields - The keys of the inferred input type that are dynamic (can be provided incrementally).
 *
 * @example
 * ```typescript
 * const schema = z.object({ name: z.string(), age: z.number(), email: z.string() });
 * type Dynamic = DynamicInput<typeof schema, 'email'>;
 * // Result: { name: string; age: number; email?: string }
 * ```
 */
export type DynamicInput<
  InputSchema extends z.ZodObject<z.ZodRawShape>,
  DynamicFields extends keyof z.infer<InputSchema>,
> = {
  [FieldName in DynamicFields]?: z.infer<InputSchema>[FieldName];
} & {
  [FieldName in Exclude<
    keyof z.infer<InputSchema>,
    DynamicFields
  >]: z.infer<InputSchema>[FieldName];
};

// Helper type to compute Influences from ToolFieldConfig parameters
type ComputedInfluences<
  InputType extends Record<string, unknown>,
  FieldName extends keyof InputType,
  Requires extends readonly Exclude<keyof InputType, FieldName>[],
  StaticFields extends keyof InputType,
> = Exclude<keyof InputType, FieldName | Requires[number] | StaticFields>;

// Type for the context passed to validate functions
export type ContextFor<
  InputType extends Record<string, unknown>,
  FieldName extends keyof InputType,
  Requires extends readonly Exclude<keyof InputType, FieldName>[] = readonly Exclude<
    keyof InputType,
    FieldName
  >[],
  StaticFields extends keyof InputType = never,
> = Pick<InputType, Requires[number]> &
  Pick<InputType, StaticFields> &
  Partial<Pick<InputType, ComputedInfluences<InputType, FieldName, Requires, StaticFields>>>;

/**
 * ToolFieldConfig is a type that describes a field in a tool specification.
 * It is used to describe the dependencies of a field,
 * as well as the validation function for the field.
 */
export type ToolFieldConfig<
  InputType extends Record<string, unknown>,
  FieldName extends keyof InputType,
  Requires extends readonly Exclude<keyof InputType, FieldName>[] = readonly Exclude<
    keyof InputType,
    FieldName
  >[],
  StaticFields extends keyof InputType = never,
> = {
  requires: Requires;
  description?: string;
  validate: (
    value: InputType[FieldName] | undefined,
    context: ContextFor<InputType, FieldName, Requires, StaticFields>,
  ) => Promise<ParameterValidationResult<InputType, FieldName>>;
};

export type ToolSpec<InputType extends Record<string, unknown>> = {
  [FieldName in keyof InputType]: ToolFieldConfig<InputType, FieldName>;
};

export type BuilderState<
  InputType extends Record<string, unknown>,
  DynamicUnion extends keyof InputType,
> = {
  readonly spec: ToolSpec<Pick<InputType, DynamicUnion>>;
};

// Simplified types for validation specifically.
export type ToolCallAccepted<InputType extends Record<string, unknown>> = {
  status: 'accepted';
  value: InputType;
};

export type ToolCallRejected<InputType extends Record<string, unknown>> = {
  status: 'rejected';
  validationResults: { [K in keyof InputType]: ParameterValidationResult<InputType, K> };
};

export type ToolCallValidationResult<InputType extends Record<string, unknown>> =
  | ToolCallAccepted<InputType>
  | ToolCallRejected<InputType>;

export type BuildContextResult<
  InputType extends Record<string, unknown>,
  FieldName extends keyof InputType,
  Requires extends readonly Exclude<keyof InputType, FieldName>[] = readonly Exclude<
    keyof InputType,
    FieldName
  >[],
  StaticFields extends keyof InputType = never,
> =
  | { success: true; context: ContextFor<InputType, FieldName, Requires, StaticFields> }
  | { success: false; missingRequirements: NonEmptyArray<keyof InputType> };

export type BuilderApi<
  InputType extends Record<string, unknown>,
  OutputType,
  Added extends keyof InputType,
  DynamicUnion extends keyof InputType,
> = {
  field: <
    FieldName extends Exclude<DynamicUnion, Added>,
    Requirements extends readonly Exclude<DynamicUnion, FieldName>[],
  >(
    key: FieldName,
    cfg: ToolFieldConfig<
      InputType,
      FieldName,
      Requirements,
      Exclude<keyof InputType, DynamicUnion | FieldName>
    >,
  ) => BuilderApi<InputType, OutputType, Added | FieldName, DynamicUnion>;
  // build: returns an SDK Tool with erased generics to avoid deep type instantiation at call sites
  build: (
    ...args: Exclude<DynamicUnion, Added> extends never
      ? []
      : [build_not_allowed_because_not_all_dynamic_fields_were_specified: never]
  ) => Exclude<DynamicUnion, Added> extends never
    ? Tool2Agent<DynamicInputType<InputType, DynamicUnion>, OutputType>
    : never;

  spec: ToolSpec<Pick<InputType, DynamicUnion>>;
};
