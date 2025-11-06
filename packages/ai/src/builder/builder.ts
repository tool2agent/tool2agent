import z from 'zod';
import { tool, ToolCallOptions } from 'ai';
import { type ToolCallResult } from '@tool2agent/types';
import { Tool2Agent } from '../tool2agent.js';
import {
  type ToolBuilderParams,
  type DynamicInputType,
  type DynamicInput,
  type BuilderState,
  type ToolSpec,
  type BuilderApi,
  type ToolFieldConfig,
} from './types.js';
import { validateToolSpec, validateToolInput } from './validation.js';

const HiddenSpecSymbol = Symbol('tool2agent-builder-spec');

// Narrow structural type for the ai.tool definition to avoid deep generic instantiation
type ToolDefinition<InputSchema extends z.ZodTypeAny, InputType, OutputType> = {
  inputSchema: InputSchema;
  description?: string;
  execute: (input: InputType, options: ToolCallOptions) => Promise<OutputType>;
};

// Erased builder (loose) — returns SDK Tool with erased generics to avoid deep type instantiation
function buildToolLoose<
  InputSchema extends z.ZodObject<z.ZodRawShape>,
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
  const dynamicInputSchema = z.object({}).extend(modifiedShape) as unknown as DynamicInputSchema;

  const t: ToolDefinition<
    DynamicInputSchema,
    DynamicInputType,
    ToolCallResult<InputType, OutputType>
  > = {
    inputSchema: dynamicInputSchema,
    description: params.description,
    execute: async (input: DynamicInputType, _options: ToolCallOptions) => {
      const result = await validateToolInput<InputType, DynamicUnion>(fullSpec, input);
      if (result.status === 'rejected') {
        return {
          ok: false,
          validationResults: result.validationResults,
        } as ToolCallResult<InputType, OutputType>;
      }
      // After status check, result is narrowed to ToolCallAccepted<InputType>, so result.value is InputType
      // params.execute now returns ToolCallResult directly, so we can return it as-is
      return await params.execute(result.value);
    },
  };
  // NOTE: Avoids pathological generic instantiation inside ai.Tool by erasing input at the call site
  // Cast to unknown first, then to Tool2Agent to avoid deep type instantiation at call sites
  const ret = tool(t as unknown as Parameters<typeof tool>[0]) as unknown as Tool2Agent<
    DynamicInput<InputSchema, DynamicUnion>,
    OutputType
  > & {
    [HiddenSpecSymbol]: ToolSpec<Pick<InputType, DynamicUnion>>;
  };
  ret[HiddenSpecSymbol] = fullSpec;
  return ret;
}

/**
 * Gets the tool specification from a tool for debugging. Only works for tools built with toolBuilder.
 * @param tool - The tool to get the specification from.
 * @returns The tool specification, or undefined if the tool was not built with toolBuilder.
 */
export function getToolBuilderSpec<
  InputType extends Record<string, unknown> = Record<string, unknown>,
>(tool: unknown): ToolSpec<InputType> | undefined {
  return (tool as { [HiddenSpecSymbol]?: ToolSpec<InputType> })[HiddenSpecSymbol];
}

/** Creates a builder for tool definitions.
 *
 * Use `.field(...)` for each dynamic field in the `InputSchema`, and then
 * call `.build()` to get the tool. The builder ensures type safety by requiring
 * all dynamic fields to be configured before building.
 *
 * The `execute` function receives fully validated input (after all dynamic fields
 * pass their validation) and must return a {@link ToolCallResult}:
 * - For success: `{ ok: true, ...output }` (spread output directly if OutputSchema is a record, otherwise use `{ value: output }`)
 * - For failure: `{ ok: false, validationResults: {...}, problems: [...], feedback: [...], instructions: [...], ... }` with structured feedback
 *
 * @param toolParams - The parameters for the tool builder.
 * @param toolParams.inputSchema - The Zod schema for the input of the tool (must be a schema of a record).
 * @param toolParams.outputSchema - The Zod schema for the output of the tool. Can be z.never() for tools that do not return a value.
 * @param toolParams.dynamicFields - Array of field names from InputSchema that are dynamic (will be made optional at runtime). Must be typed `as const`.
 * @param toolParams.description - Description of the tool for the LLM.
 * @param toolParams.execute - Function that executes the tool with validated input. Called only after all dynamic fields pass validation. Must return a {@link ToolCallResult}.
 * @returns A builder object with `.field()` and `.build()` methods.
 *
 * @example
 * ```typescript
 * const tool = toolBuilder({
 *   inputSchema: z.object({ name: z.string(), age: z.number() }),
 *   outputSchema: z.object({ greeting: z.string() }),
 *   dynamicFields: ['name', 'age'],
 *   execute: async (input) => {
 *     return { ok: true, greeting: `Hello, ${input.name}!` };
 *   },
 * })
 *   .field('name', { ... })
 *   .field('age', { ... })
 *   .build();
 * ```
 */
export function toolBuilder<
  InputSchema extends z.ZodObject<z.ZodRawShape>,
  OutputSchema extends z.ZodTypeAny,
  DynamicFields extends keyof z.infer<InputSchema> & string,
>(
  toolParams: ToolBuilderParams<InputSchema, OutputSchema, DynamicFields>,
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
     * @param name - The key of the field to add.
     * @param fieldParams - The configuration for the field.
     * @param fieldParams.requires - The fields that are required for the validation of this field.
     * @param fieldParams.description - The description of the field for the schema.
     * @param fieldParams.validate - The validation function for the field value.
     * @returns A new builder with the field added.
     */
    field: (name, fieldParams) => {
      const normalizedCfg: ToolFieldConfig<
        InputType,
        typeof name,
        Exclude<keyof InputType, typeof name>[],
        Exclude<keyof InputType, DynamicFields | typeof name>
      > = {
        requires: [...fieldParams.requires] as Exclude<keyof InputType, typeof name>[],
        description: fieldParams.description,
        validate: fieldParams.validate as ToolFieldConfig<
          InputType,
          typeof name,
          Exclude<keyof InputType, typeof name>[],
          Exclude<keyof InputType, DynamicFields | typeof name>
        >['validate'],
      };
      const nextSpec: ToolSpec<Pick<InputType, DynamicFields | typeof name>> = {
        ...state.spec,
        [name]: normalizedCfg,
      };
      const next: BuilderState<InputType, DynamicFields> = { spec: nextSpec };
      return makeApi<InputSchema, OutputSchema, InputType, OutputType, typeof name, DynamicFields>(
        toolParams,
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
        toolParams,
        provided,
      ) as Tool2Agent<DynamicInputType<InputType, DynamicFields>, OutputType>;
    }) as BuilderApi<InputType, OutputType, never, DynamicFields>['build'],
  } as BuilderApi<InputType, OutputType, never, DynamicFields>;
}

function makeApi<
  InputSchema extends z.ZodObject<z.ZodRawShape>,
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
      const normalizedCfg: ToolFieldConfig<
        InputType,
        typeof key,
        Exclude<keyof InputType, typeof key>[],
        Exclude<keyof InputType, DynamicUnion | typeof key>
      > = {
        requires: [...cfg.requires] as Exclude<keyof InputType, typeof key>[],
        description: cfg.description,
        validate: cfg.validate as ToolFieldConfig<
          InputType,
          typeof key,
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
    build: ((..._args: unknown[]) => {
      // Build spec from provided fields
      const provided = state.spec;
      return buildToolLoose<InputSchema, OutputSchema, DynamicUnion & keyof z.infer<InputSchema>>(
        params,
        provided as ToolSpec<Pick<z.infer<InputSchema>, DynamicUnion & keyof z.infer<InputSchema>>>,
      );
    }) as unknown as BuilderApi<InputType, OutputType, Added, DynamicUnion>['build'],
  } as BuilderApi<InputType, OutputType, Added, DynamicUnion>;
}
