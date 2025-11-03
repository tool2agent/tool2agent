import z from 'zod';
import { tool, ToolCallOptions } from 'ai';
import { validate, type FieldSpec, type ToolSpec, validateToolSpec } from './validation.js';
import { type ParameterFeedback, type ToolCallResult } from '@tool2agent/types';
import { Tool2Agent } from './tool2agent.js';

export type ToolBuilderParams<
  InputSchema extends z.ZodObject<any>,
  OutputSchema extends z.ZodTypeAny,
  DynamicKeys extends keyof z.infer<InputSchema>,
> = {
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  dynamicFields: readonly DynamicKeys[];
  description?: string;
  execute: (input: z.infer<InputSchema>) => Promise<z.infer<OutputSchema>>;
};

export type DynamicInputType<
  InputType extends Record<string, unknown>,
  DynamicFields extends keyof InputType,
> = {
  [K in DynamicFields]?: InputType[K];
} & {
  [K in Exclude<keyof InputType, DynamicFields>]: InputType[K];
};

export type DynamicInput<
  InputSchema extends z.ZodObject<any>,
  DynamicFields extends keyof z.infer<InputSchema>,
> = {
  [K in DynamicFields]?: z.infer<InputSchema>[K];
} & {
  [K in Exclude<keyof z.infer<InputSchema>, DynamicFields>]: z.infer<InputSchema>[K];
};

export type BuilderState<
  InputType extends Record<string, unknown>,
  DynamicUnion extends keyof InputType,
> = {
  readonly spec: ToolSpec<Pick<InputType, DynamicUnion>>;
};

export type ToolFieldConfig<
  InputType extends Record<string, unknown>,
  K extends keyof InputType,
  Requires extends readonly Exclude<keyof InputType, K>[] = readonly Exclude<keyof InputType, K>[],
  Influences extends readonly Exclude<keyof InputType, K>[] = readonly Exclude<
    keyof InputType,
    K
  >[],
  StaticFields extends keyof InputType = never,
> = {
  requires: Requires;
  influencedBy: Influences;
  description?: string;
  validate: (
    value: InputType[K] | undefined,
    context: Pick<InputType, Requires[number]> &
      Partial<Pick<InputType, Influences[number]>> &
      Pick<InputType, StaticFields>,
  ) => Promise<ParameterFeedback<InputType, K>>;
};

export const HiddenSpecSymbol = Symbol('HiddenSpec');

// Narrow structural type for the ai.tool definition to avoid deep generic instantiation
type ToolDefinition<InputSchema extends z.ZodTypeAny, InputType, OutputType> = {
  inputSchema: InputSchema;
  description?: string;
  execute: (input: InputType, options: ToolCallOptions) => Promise<OutputType>;
};

type BuilderApi<
  InputType extends Record<string, unknown>,
  OutputType,
  Added extends keyof InputType,
  DynamicUnion extends keyof InputType,
> = {
  field: <
    K extends Exclude<DynamicUnion, Added>,
    R extends readonly Exclude<DynamicUnion, K>[],
    I extends readonly Exclude<DynamicUnion, K>[],
  >(
    key: K,
    cfg: ToolFieldConfig<InputType, K, R, I, Exclude<keyof InputType, DynamicUnion | K>>,
  ) => BuilderApi<InputType, OutputType, Added | K, DynamicUnion>;
  // build: returns an SDK Tool with erased generics to avoid deep type instantiation at call sites
  build: (
    ...args: Exclude<DynamicUnion, Added> extends never ? [] : [arg: never]
  ) => Exclude<DynamicUnion, Added> extends never
    ? Tool2Agent<DynamicInputType<InputType, DynamicUnion>, OutputType>
    : never;

  spec: ToolSpec<Pick<InputType, DynamicUnion>>;
};

// Erased builder (loose) — returns SDK Tool with erased generics to avoid deep type instantiation
function buildToolLoose<
  InputSchema extends z.ZodObject<any>,
  OutputSchema extends z.ZodTypeAny,
  DynamicUnion extends keyof z.infer<InputSchema>,
>(
  params: ToolBuilderParams<InputSchema, OutputSchema, DynamicUnion>,
  fullSpec: ToolSpec<Pick<z.infer<InputSchema>, DynamicUnion>>,
): Tool2Agent<DynamicInput<InputSchema, DynamicUnion>, z.infer<OutputSchema>> {
  type InputType = z.infer<InputSchema>;
  type OutputType = z.infer<OutputSchema>;
  type DynamicInputType = DynamicInput<InputSchema, DynamicUnion>;
  type DynamicInputSchema = z.ZodType<DynamicInputType>;

  validateToolSpec(fullSpec);

  // Create an input schema where ONLY dynamic fields are optional
  const originalShape = params.inputSchema.shape as Record<string, z.ZodTypeAny>;
  const dynamicSet = new Set<keyof InputType>(params.dynamicFields);
  const modifiedShape: Record<string, z.ZodTypeAny> = {};
  for (const key in originalShape) {
    const base = originalShape[key];
    // Make dynamic fields optional, keep static fields as is.
    modifiedShape[key] = dynamicSet.has(key) ? base.optional() : base;
  }
  // Object.fromEntries doesn't preserve exact type structure, so cast is needed
  const dynamicInputSchema = z.object({}).extend(modifiedShape) as any as DynamicInputSchema;

  const t: ToolDefinition<
    DynamicInputSchema,
    DynamicInputType,
    ToolCallResult<InputType, OutputType>
  > = {
    inputSchema: dynamicInputSchema,
    description: params.description,
    execute: async (input: DynamicInputType, options: ToolCallOptions) => {
      const result = await validate<InputType, DynamicUnion>(fullSpec, input);
      if (result.status === 'rejected') {
        return {
          ok: false,
          validationResults: result.validationResults,
        } as ToolCallResult<InputType, OutputType>;
      }
      // After status check, result is narrowed to ToolCallAccepted<InputType>, so result.value is InputType
      const value = await params.execute(result.value);
      // ToolCallResult branches: if OutputType is a Record, flatten it; otherwise wrap in value field
      // TypeScript cannot infer the exact union type structure, so cast is needed
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return { ok: true, ...value } as ToolCallResult<InputType, OutputType>;
      }
      return { ok: true, value } as ToolCallResult<InputType, OutputType>;
    },
  };
  // NOTE: Avoids pathological generic instantiation inside ai.Tool by erasing input at the call site
  // Cast to unknown first, then to Tool2Agent to avoid deep type instantiation at call sites
  const ret = tool(t as unknown as any) as unknown as Tool2Agent<
    DynamicInput<InputSchema, DynamicUnion>,
    OutputType
  > & {
    [HiddenSpecSymbol]: ToolSpec<Pick<InputType, DynamicUnion>>;
  };
  ret[HiddenSpecSymbol] = fullSpec;
  return ret;
}

/** Creates a builder for tool definitions.
 * Use `.field(...)` for each field in the `InputSchema`, and then
 * call `.build()` to get the tool.
 * If you miss any of the fields, `.build()` will error on the type level.
 * @param params - The parameters for the tool.
 * @param params.inputSchema - The schema for the input of the tool.
 * @param params.outputSchema - The schema for the output of the tool.
 * @param params.description - The description of the tool.
 * @param params.execute - The function to execute the tool, that will be called with the validated input. Must accept a value corresponding to inputSchema, and output a value corresponding to outputSchema.
 * @returns A builder object for the tool.
 */
export function toolBuilder<
  InputSchema extends z.ZodObject<any>,
  OutputSchema extends z.ZodTypeAny,
  DynamicFields extends keyof z.infer<InputSchema> & string,
>(
  params: ToolBuilderParams<InputSchema, OutputSchema, DynamicFields>,
): BuilderApi<z.infer<InputSchema>, z.infer<OutputSchema>, never, DynamicFields> {
  type InputType = z.infer<InputSchema>;
  type OutputType = z.infer<OutputSchema>;
  const state: BuilderState<InputType, DynamicFields> = {
    spec: {} as ToolSpec<Pick<InputType, DynamicFields>>,
  };

  return {
    spec: state.spec,
    /**
     * Populates the tool specification with a new field.
     * @param key - The key of the field to add.
     * @param cfg - The configuration for the field.
     * @param cfg.requires - The fields that are required for the validation of this field.
     * @param cfg.influencedBy - The fields that are used to influence the validation of this field (optional dependencies)
     * @param cfg.description - The description of the field for the schema.
     * @param cfg.validate - The validation function for the field value.
     * @returns A new builder with the field added.
     */
    field: (key, cfg) => {
      const normalizedCfg: FieldSpec<
        InputType,
        typeof key,
        Exclude<keyof InputType, typeof key>[],
        Exclude<keyof InputType, typeof key>[],
        Exclude<keyof InputType, DynamicFields | typeof key>
      > = {
        requires: [...cfg.requires] as Exclude<keyof InputType, typeof key>[],
        influencedBy: [...cfg.influencedBy] as Exclude<keyof InputType, typeof key>[],
        description: cfg.description,
        validate: cfg.validate as FieldSpec<
          InputType,
          typeof key,
          Exclude<keyof InputType, typeof key>[],
          Exclude<keyof InputType, typeof key>[],
          Exclude<keyof InputType, DynamicFields | typeof key>
        >['validate'],
      };
      const nextSpec: ToolSpec<Pick<InputType, DynamicFields | typeof key>> = {
        ...state.spec,
        [key]: normalizedCfg,
      };
      const next: BuilderState<InputType, DynamicFields> = { spec: nextSpec };
      return makeApi<InputSchema, OutputSchema, InputType, OutputType, typeof key, DynamicFields>(
        params,
        next,
      );
    },
    /**
     * Builds the tool from the specification.
     * @returns A tool that can be used to call the LLM.
     * Will error on the type level if any of the fields are missing.
     */
    build: (() => {
      // Build spec from provided fields
      const provided = state.spec;
      return buildToolLoose<InputSchema, OutputSchema, DynamicFields>(
        params,
        provided,
      ) as Tool2Agent<DynamicInputType<InputType, DynamicFields>, OutputType>;
    }) as BuilderApi<InputType, OutputType, never, DynamicFields>['build'],
  } as BuilderApi<InputType, OutputType, never, DynamicFields>;
}

function makeApi<
  InputSchema extends z.ZodObject<any>,
  OutputSchema extends z.ZodTypeAny,
  InputType extends z.infer<InputSchema>,
  OutputType extends z.infer<OutputSchema>,
  Added extends keyof InputType,
  DynamicUnion extends keyof InputType & string,
>(
  params: ToolBuilderParams<InputSchema, OutputSchema, DynamicUnion>,
  state: BuilderState<InputType, DynamicUnion>,
): BuilderApi<InputType, OutputType, Added, DynamicUnion> {
  return {
    field: (key, cfg) => {
      const normalizedCfg: FieldSpec<
        InputType,
        typeof key,
        Exclude<keyof InputType, typeof key>[],
        Exclude<keyof InputType, typeof key>[],
        Exclude<keyof InputType, DynamicUnion | typeof key>
      > = {
        requires: [...cfg.requires] as Exclude<keyof InputType, typeof key>[],
        influencedBy: [...cfg.influencedBy] as Exclude<keyof InputType, typeof key>[],
        description: cfg.description,
        validate: cfg.validate as FieldSpec<
          InputType,
          typeof key,
          Exclude<keyof InputType, typeof key>[],
          Exclude<keyof InputType, typeof key>[],
          Exclude<keyof InputType, DynamicUnion | typeof key>
        >['validate'],
      };
      const nextSpec: ToolSpec<Pick<InputType, DynamicUnion | typeof key>> = {
        ...state.spec,
        [key]: normalizedCfg,
      };
      const nextState: BuilderState<InputType, DynamicUnion> = { spec: nextSpec };
      return makeApi<
        InputSchema,
        OutputSchema,
        InputType,
        OutputType,
        Added | typeof key,
        DynamicUnion
      >(params, nextState);
    },
    build: ((..._args: any[]) => {
      // Build spec from provided fields
      const provided = state.spec;
      return buildToolLoose<InputSchema, OutputSchema, DynamicUnion & keyof z.infer<InputSchema>>(
        params,
        provided as ToolSpec<Pick<z.infer<InputSchema>, DynamicUnion & keyof z.infer<InputSchema>>>,
      );
    }) as unknown as BuilderApi<InputType, OutputType, Added, DynamicUnion>['build'],
  } as BuilderApi<InputType, OutputType, Added, DynamicUnion>;
}
