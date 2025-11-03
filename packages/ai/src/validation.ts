import { detectRequiresCycles, toposortFields } from './graph.js';
import { type ParameterValidationResult, type NonEmptyArray } from '@tool2agent/types';
import { isDeepStrictEqual } from 'util';
import { log, delayedLog } from './internal-logger.js';
import type { DynamicInputType } from './builder.js';

// Simplified types for validation specifically.

export type ToolCallAccepted<InputType extends Record<string, unknown>> = {
  status: 'accepted';
  value: InputType;
};

export type ToolCallRejected<InputType extends Record<string, unknown>> = {
  status: 'rejected';
  validationResults: { [K in keyof InputType]: ParameterValidationResult<InputType, K> };
};

export type ToolCallResult<InputType extends Record<string, unknown>> =
  | ToolCallAccepted<InputType>
  | ToolCallRejected<InputType>;

/**
 * FieldSpec is a type that describes a field in a tool specification.
 * It is used to describe the dependencies of a field,
 * as well as the validation function for the field.
 */
export type FieldSpec<
  InputType extends Record<string, unknown>,
  Key extends keyof InputType,
  Requires extends Exclude<keyof InputType, Key>[] = Exclude<keyof InputType, Key>[],
  Influences extends Exclude<keyof InputType, Key>[] = Exclude<keyof InputType, Key>[],
  StaticFields extends keyof InputType = never,
> = {
  requires: Requires;
  influencedBy: Influences;
  description?: string;
  validate: (
    value: InputType[Key] | undefined,
    context: Pick<InputType, Requires[number]> &
      Partial<Pick<InputType, Influences[number]>> &
      Pick<InputType, StaticFields>,
  ) => Promise<ParameterValidationResult<InputType, Key>>;
};

export type ToolSpec<InputType extends Record<string, unknown>> = {
  [Key in keyof InputType]: FieldSpec<InputType, Key>;
};

export function validateToolSpec<
  InputType extends Record<string, unknown>,
  DynamicFields extends keyof InputType,
>(spec: ToolSpec<Pick<InputType, DynamicFields>>): void {
  const flowLike: Record<
    string,
    { requires: string[]; influencedBy: string[]; description: string }
  > = {};
  for (const key of Object.keys(spec) as DynamicFields[]) {
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
}

export async function validate<
  InputType extends Record<string, unknown>,
  DynamicFields extends keyof InputType,
>(
  spec: ToolSpec<Pick<InputType, DynamicFields>>,
  loose: DynamicInputType<InputType, DynamicFields>,
): Promise<ToolCallResult<InputType>> {
  // Local type aliases for cleaner types
  type ValidationMap = { [P in keyof InputType]?: ParameterValidationResult<InputType, P> };

  const dynamicFields = Object.keys(spec) as DynamicFields[];
  const dynamicSet = new Set(dynamicFields);

  delayedLog(() => ['validate(', JSON.stringify(loose, null, 2), ')']);

  // Validation results for all fields.
  const validationResults: ValidationMap = {};

  // Overwrites for normalized RETURN values (from validate). Not every field's validate() returns a normalized value.
  // Some of the values are accepted as is, without normalization.
  let validFields: Partial<InputType> = initializeStaticFields(
    loose,
    dynamicSet,
  ) as Partial<InputType>;
  const sortedFields = sortFields(spec);

  for (const dynamicField of sortedFields) {
    type Key = typeof dynamicField;
    type Value = InputType[Key];

    const fieldSpec: FieldSpec<InputType, Key> = spec[dynamicField]!;
    // Dynamic fields are optional in DynamicInputType
    const value: Value | undefined = (loose as Partial<InputType>)[dynamicField];

    const contextResult = buildContext(fieldSpec, dynamicField, validFields, dynamicSet);
    if (!contextResult.success) {
      validationResults[dynamicField] = {
        valid: false,
        requiresValidParameters: contextResult.missingRequirements,
      } as ParameterValidationResult<InputType, Key>;
      continue;
    }

    const validationResult = await fieldSpec.validate(value, contextResult.context);

    const processed = processValidationResult(dynamicField, value, validationResult);
    validFields = { ...validFields, ...processed.validFields };

    delayedLog(() => [
      String(dynamicField) +
        '.validate(' +
        JSON.stringify(value, null, 2) +
        ', ' +
        JSON.stringify(contextResult.context, null, 2) +
        ') -> ' +
        JSON.stringify(processed.validationResult, null, 2),
    ]);

    validationResults[dynamicField] = processed.validationResult as ParameterValidationResult<
      InputType,
      Key
    >;
  }

  const allValidOrSkipped = sortedFields.every(k => validationResults[k]?.valid !== false);

  if (!allValidOrSkipped) {
    const res = { status: 'rejected', validationResults } as ToolCallRejected<InputType>;
    log('validate:rejected', JSON.stringify(res, null, 2));
    return res;
  }

  const res = {
    status: 'accepted',
    value: validFields as InputType,
  } as ToolCallAccepted<InputType>;
  log('validate:accepted', JSON.stringify(res, null, 2));
  return res;
}

// Internal helper functions for validate
function initializeStaticFields<
  InputType extends Record<string, unknown>,
  DynamicFields extends keyof InputType,
>(
  dynamicInput: DynamicInputType<InputType, DynamicFields>,
  dynamicSet: Set<DynamicFields>,
): Pick<InputType, Exclude<keyof InputType, DynamicFields>> {
  // Seed static fields (non-dynamic) into context immediately. They are always available.
  // Extract all keys from the input, filter out dynamic fields
  // Cast to Partial<InputType> for iteration since DynamicInputType doesn't have index signature
  const staticFields = {} as Pick<InputType, Exclude<keyof InputType, DynamicFields>>;
  for (const k of Object.keys(dynamicInput) as DynamicFields[]) {
    const key = k;
    if (!dynamicSet.has(key as DynamicFields)) {
      // Static fields are required in DynamicInputType, so safe to access
      const v = dynamicInput[k];
      if (typeof v !== 'undefined') {
        staticFields[key as unknown as Exclude<keyof InputType, DynamicFields>] =
          v as InputType[Exclude<keyof InputType, DynamicFields>];
      }
    }
  }
  return staticFields;
}

function sortFields<
  InputType extends Record<string, unknown>,
  DynamicFields extends keyof InputType,
>(spec: ToolSpec<Pick<InputType, DynamicFields>>): DynamicFields[] {
  // Use topologically sorted keys based on requires/influencedBy prioritization.
  const topoKeys = toposortFields(
    spec as unknown as Record<string, { requires: string[]; influencedBy: string[] }>,
  );
  return topoKeys as DynamicFields[];
}

// Type for the context passed to validate functions
export type ContextFor<InputType extends Record<string, unknown>, K extends keyof InputType> = Pick<
  InputType,
  FieldSpec<InputType, K>['requires'][number]
> &
  Partial<Pick<InputType, FieldSpec<InputType, K>['influencedBy'][number]>> &
  Partial<InputType>;

export type BuildContextResult<
  InputType extends Record<string, unknown>,
  K extends keyof InputType,
> =
  | { success: true; context: ContextFor<InputType, K> }
  | { success: false; missingRequirements: NonEmptyArray<keyof InputType> };

export function buildContext<InputType extends Record<string, unknown>, K extends keyof InputType>(
  rule: FieldSpec<InputType, K>,
  fieldKey: K,
  validFields: Partial<InputType>,
  dynamicSet: Set<keyof InputType>,
): BuildContextResult<InputType, K> {
  // Check if all required fields are present
  const missing = rule.requires.filter(dep => typeof validFields[dep] === 'undefined');
  if (missing.length > 0) {
    log('validate:skipping (missing requirements)', { field: fieldKey, missing });
    return {
      success: false,
      missingRequirements: missing as unknown as NonEmptyArray<keyof InputType>,
    };
  }

  const contextEntries: [string, unknown][] = [];

  // Add required fields
  for (const requiredContextField of rule.requires) {
    const v = validFields[requiredContextField];
    if (typeof v !== 'undefined') {
      contextEntries.push([String(requiredContextField), v]);
    }
  }

  // Add optional influencedBy fields
  for (const optionalContextField of rule.influencedBy) {
    const v = validFields[optionalContextField];
    if (typeof v !== 'undefined') {
      contextEntries.push([String(optionalContextField), v]);
    }
  }

  // Include static fields (not in dynamicFields) in context
  // Iterate over all keys in validFields to find static ones
  for (const staticKey in validFields) {
    const key = staticKey as keyof InputType;
    if (key === fieldKey) continue; // Skip the current field
    if (!dynamicSet.has(key)) {
      const v = validFields[key];
      if (typeof v !== 'undefined') {
        contextEntries.push([String(key), v]);
      }
    }
  }

  return {
    success: true,
    context: Object.fromEntries(contextEntries) as ContextFor<InputType, K>,
  };
}

function processValidationResult<
  InputType extends Record<string, unknown>,
  K extends keyof InputType,
>(
  fieldKey: K,
  value: InputType[K] | undefined,
  validationResult: ParameterValidationResult<InputType, K>,
): {
  validationResult: ParameterValidationResult<InputType, K>;
  validFields: Partial<InputType>;
} {
  // Create a copy of validationResult, removing normalizedValue if it's equal to the original value (no-op normalization)
  const processedResult: ParameterValidationResult<InputType, K> = isDeepStrictEqual(
    value,
    validationResult.normalizedValue,
  )
    ? (() => {
        const { normalizedValue, ...rest } = validationResult;
        return rest as ParameterValidationResult<InputType, K>;
      })()
    : { ...validationResult };

  // Build the validFields update based on validation result
  const validFields: Partial<InputType> = {};
  if (processedResult.valid) {
    if (typeof processedResult.normalizedValue !== 'undefined') {
      validFields[fieldKey] = processedResult.normalizedValue;
    } else {
      validFields[fieldKey] = value;
    }
  }

  return {
    validationResult: processedResult,
    validFields,
  };
}
