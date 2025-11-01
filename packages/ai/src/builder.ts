import z from 'zod';
import { tool } from 'ai';
import { compileFixup, type FieldSpec, type ToolSpec } from './validation.js';
import { detectRequiresCycles } from './graph.js';
import { type ParameterFeedback, type ToolInputType } from '@tool2agent/types';
import { Tool2Agent } from './tool2agent.js';

type MkToolParams<InputSchema extends z.ZodObject<any>, OutputSchema extends z.ZodTypeAny> = {
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  description?: string;
  execute: (input: z.infer<InputSchema>) => Promise<z.infer<OutputSchema>>;
};

type BuilderState<D extends ToolInputType> = {
  readonly spec: Partial<ToolSpec<D>>;
};

export type FieldConfig<
  D extends ToolInputType,
  K extends keyof D,
  Requires extends readonly Exclude<keyof D, K>[] = readonly Exclude<keyof D, K>[],
  Influences extends readonly Exclude<keyof D, K>[] = readonly Exclude<keyof D, K>[],
> = {
  requires: Requires;
  influencedBy: Influences;
  description?: string;
  validate: (
    value: D[K] | undefined,
    context: Pick<D, Requires[number]> & Partial<Pick<D, Influences[number]>>,
  ) => Promise<ParameterFeedback<D, K>>;
};

export const HiddenSpecSymbol = Symbol('HiddenSpec');

// Narrow structural type for the ai.tool definition to avoid deep generic instantiation
type ToolDefinition<InputSchema extends z.ZodTypeAny, OutputSchema extends z.ZodTypeAny> = {
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  description?: string;
  execute: (input: unknown, options: unknown) => Promise<z.infer<OutputSchema>>;
};

type BuilderApi<
  InputSchema extends z.ZodObject<any>,
  OutputSchema extends z.ZodTypeAny,
  Added extends keyof z.infer<InputSchema>,
> = {
  field: <
    K extends Exclude<keyof z.infer<InputSchema>, Added>,
    R extends readonly Exclude<keyof z.infer<InputSchema>, K>[],
    I extends readonly Exclude<keyof z.infer<InputSchema>, K>[],
  >(
    key: K,
    cfg: FieldConfig<z.infer<InputSchema>, K, R, I>,
  ) => BuilderApi<InputSchema, OutputSchema, Added | K>;
  // build: returns an SDK Tool with erased generics to avoid deep type instantiation at call sites
  build: (
    ...args: Exclude<keyof z.infer<InputSchema>, Added> extends never ? [] : [arg: never]
  ) => Exclude<keyof z.infer<InputSchema>, Added> extends never
    ? Tool2Agent<InputSchema, OutputSchema>
    : never;

  spec: ToolSpec<z.infer<InputSchema>>;
};

// Erased builder (loose) — returns SDK Tool with erased generics to avoid deep type instantiation
function buildToolLoose<InputSchema extends z.ZodObject<any>, OutputSchema extends z.ZodTypeAny>(
  params: MkToolParams<InputSchema, OutputSchema>,
  spec: ToolSpec<z.infer<InputSchema>>,
): Tool2Agent<z.infer<InputSchema>, z.infer<OutputSchema>> {
  type InputType = z.infer<InputSchema>;
  type OutputType = z.infer<OutputSchema>;
  type PartialInputType = Partial<InputType>;
  type PartialInputSchema = z.ZodType<PartialInputType>;
  // Cycle detection on the dependency graph upfront (defensive runtime check)
  const flowLike: Record<
    string,
    { requires: string[]; influencedBy: string[]; description: string }
  > = {};
  for (const key of Object.keys(spec) as (keyof InputType)[]) {
    const rule = spec[key];
    flowLike[String(key)] = {
      requires: rule.requires as string[],
      influencedBy: rule.influencedBy as string[],
      description: rule.description ?? '',
    };
  }
  const cycles = detectRequiresCycles(flowLike);
  if (cycles.length > 0) {
    const msg = cycles.map(c => c.join(' -> ')).join('; ');
    throw new Error(`Cycle detected in requires graph: ${msg}`);
  }

  const fixup = compileFixup(spec);

  const wrappedOutputSchema = z.discriminatedUnion('status', [
    z.object({
      status: z.literal('rejected' as const),
      validationResults: z.record(
        z.string(),
        z.object({
          valid: z.boolean(),
          allowedValues: z.array(z.any()).optional(),
          refusalReasons: z.array(z.string()).optional(),
        }),
      ),
    }),
    z.object({ status: z.literal('accepted' as const), value: params.outputSchema }),
  ]) as z.ZodTypeAny;

  // .partial() call is safe because InputSchema extends z.ZodObject<any>
  // We cast to satisfy TypeScript's type checker, but this is safe at runtime.
  const partialInputSchema = params.inputSchema.partial() as any as PartialInputSchema;

  const t: ToolDefinition<PartialInputSchema, typeof wrappedOutputSchema> = {
    inputSchema: partialInputSchema,
    outputSchema: wrappedOutputSchema,
    description: params.description,
    execute: async (input: unknown, options: unknown) => {
      const result = await fixup(input as Partial<InputType>);
      if (result.status === 'rejected') {
        return {
          status: 'rejected' as const,
          validationResults: result.validationResults,
        };
      }
      const value = await params.execute(result.value as InputType);
      return { status: 'accepted' as const, value };
    },
  };
  // NOTE: Avoids pathological generic instantiation inside ai.Tool by erasing input at the call site
  const ret = tool(t as unknown as any) as unknown as Tool2Agent<InputType, OutputType> & {
    [HiddenSpecSymbol]: ToolSpec<InputType>;
  };
  ret[HiddenSpecSymbol] = spec;
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
export function mkTool<InputSchema extends z.ZodObject<any>, OutputSchema extends z.ZodTypeAny>(
  params: MkToolParams<InputSchema, OutputSchema>,
): BuilderApi<InputSchema, OutputSchema, never> {
  type InputType = z.infer<InputSchema>;
  const state: BuilderState<InputType> = { spec: {} };

  return {
    spec: state.spec as ToolSpec<InputType>, // a lie :)
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
      const normalizedCfg: FieldSpec<InputType, typeof key> = {
        requires: [...(cfg.requires as readonly Exclude<keyof InputType, typeof key>[])] as Exclude<
          keyof InputType,
          typeof key
        >[],
        influencedBy: [
          ...(cfg.influencedBy as readonly Exclude<keyof InputType, typeof key>[]),
        ] as Exclude<keyof InputType, typeof key>[],
        description: cfg.description,
        validate: cfg.validate,
      };
      const nextSpec: Partial<ToolSpec<InputType>> = { ...state.spec, [key]: normalizedCfg };
      const next: BuilderState<InputType> = { spec: nextSpec };
      return makeApi<InputSchema, OutputSchema, typeof key>(params, next);
    },
    /**
     * Builds the tool from the specification.
     * @returns A tool that can be used to call the LLM.
     * Will error on the type level if any of the fields are missing.
     */
    build: (() =>
      buildToolLoose<InputSchema, OutputSchema>(
        params,
        state.spec as ToolSpec<InputType>,
      )) as BuilderApi<InputSchema, OutputSchema, never>['build'],
  } as BuilderApi<InputSchema, OutputSchema, never>;
}

function makeApi<
  InputSchema extends z.ZodObject<any>,
  OutputSchema extends z.ZodTypeAny,
  Added extends keyof z.infer<InputSchema>,
>(
  params: MkToolParams<InputSchema, OutputSchema>,
  state: BuilderState<z.infer<InputSchema>>,
): BuilderApi<InputSchema, OutputSchema, Added> {
  type InputType = z.infer<InputSchema>;
  return {
    field: (key, cfg) => {
      const normalizedCfg: FieldSpec<InputType, typeof key> = {
        requires: [
          ...(cfg.requires as readonly Exclude<keyof InputType, typeof key>[]),
        ] as unknown as Exclude<keyof InputType, typeof key>[],
        influencedBy: [
          ...(cfg.influencedBy as readonly Exclude<keyof InputType, typeof key>[]),
        ] as unknown as Exclude<keyof InputType, typeof key>[],
        description: cfg.description,
        validate: cfg.validate,
      };
      const nextSpec: Partial<ToolSpec<InputType>> = { ...state.spec, [key]: normalizedCfg };
      const nextState: BuilderState<InputType> = { spec: nextSpec };
      return makeApi<InputSchema, OutputSchema, Added | typeof key>(params, nextState);
    },
    build: ((..._args: any[]) =>
      buildToolLoose<InputSchema, OutputSchema>(
        params,
        state.spec as ToolSpec<InputType>,
      )) as BuilderApi<InputSchema, OutputSchema, Added>['build'],
  } as BuilderApi<InputSchema, OutputSchema, Added>;
}
