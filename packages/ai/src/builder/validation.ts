import { type ParameterValidationResult, type NonEmptyArray } from '@tool2agent/types';
import { detectRequiresCycles, toposortFields } from './graph.js';
import { isDeepStrictEqual } from 'util';
import { log, delayedLog } from '../internal/logger.js';
import type {
  ToolFieldConfig,
  ToolSpec,
  DynamicInputType,
  ContextFor,
  BuildContextResult,
  ToolCallAccepted,
  ToolCallRejected,
  ToolCallValidationResult,
} from './types.js';

export function validateToolSpec<
  InputType extends Record<string, unknown>,
  DynamicFields extends keyof InputType,
>(spec: ToolSpec<Pick<InputType, DynamicFields>>): void {
  const flowLike: Record<string, { requires: string[] }> = {};
  for (const key of Object.keys(spec) as DynamicFields[]) {
    const rule = spec[key];
    flowLike[String(key)] = {
      requires: rule.requires as unknown as string[],
    };
  }
  const cycles = detectRequiresCycles(flowLike);
  if (cycles.length > 0) {
    const msg = cycles.map(c => c.join(' -> ')).join('; ');
    throw new Error(`Cycle detected in requires graph: ${msg}`);
  }
}

export function buildContext<
  InputType extends Record<string, unknown>,
  K extends keyof InputType,
  Requires extends readonly Exclude<keyof InputType, K>[],
  StaticFields extends keyof InputType,
>(
  rule: ToolFieldConfig<InputType, K, Requires, StaticFields>,
  fieldKey: K,
  validFields: Partial<InputType>,
  dynamicSet: Set<keyof InputType>,
): BuildContextResult<InputType, K, Requires, StaticFields> {
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

  // Include static fields (not in dynamicFields) in context
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

  // Add all other dynamic fields as optional (excluding current field and required fields)
  for (const key in validFields) {
    const fieldKeyTyped = key as keyof InputType;
    if (fieldKeyTyped === fieldKey) continue; // Skip the current field
    if (rule.requires.includes(fieldKeyTyped as unknown as (typeof rule.requires)[number]))
      continue; // Skip required fields (already added)
    if (!dynamicSet.has(fieldKeyTyped)) continue; // Skip static fields (already added)
    const v = validFields[fieldKeyTyped];
    if (typeof v !== 'undefined') {
      contextEntries.push([String(fieldKeyTyped), v]);
    }
  }

  return {
    success: true,
    context: Object.fromEntries(contextEntries) as ContextFor<InputType, K, Requires, StaticFields>,
  };
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
    if (!dynamicSet.has(key)) {
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
  // Use topologically sorted keys based on requires dependencies.
  const topoKeys = toposortFields(spec as unknown as Record<string, { requires: string[] }>);
  return topoKeys as DynamicFields[];
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
        const { normalizedValue: _normalizedValue, ...rest } = validationResult;
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

export async function validateToolInput<
  InputType extends Record<string, unknown>,
  DynamicFields extends keyof InputType,
>(
  spec: ToolSpec<Pick<InputType, DynamicFields>>,
  loose: DynamicInputType<InputType, DynamicFields>,
): Promise<ToolCallValidationResult<InputType>> {
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

    const fieldSpec: ToolFieldConfig<InputType, Key> = spec[dynamicField];
    if (!fieldSpec) {
      throw new Error(`Field spec not found for ${String(dynamicField)}`);
    }
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

    validationResults[dynamicField] = processed.validationResult;
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
