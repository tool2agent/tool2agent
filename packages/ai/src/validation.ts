import { detectRequiresCycles } from './graph.js';
import { type ParameterFeedback, type NonEmptyArray } from '@tool2agent/types';
import { isDeepStrictEqual } from 'util';
import { log } from './internal-logger.js';
import type { DynamicInputType } from './builder.js';

// Simplified types for validation specifically.

export type ToolCallAccepted<D extends Record<string, unknown>> = {
  status: 'accepted';
  value: D;
};

export type ToolCallRejected<D extends Record<string, unknown>> = {
  status: 'rejected';
  validationResults: { [K in keyof D]: ParameterFeedback<D, K> };
};

export type ToolCallResult<D extends Record<string, unknown>> =
  | ToolCallAccepted<D>
  | ToolCallRejected<D>;

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
  ) => Promise<ParameterFeedback<InputType, Key>>;
};

export type ToolSpec<
  InputType extends Record<string, unknown>,
  Keys extends keyof InputType = keyof InputType,
> = {
  [Key in Keys]: FieldSpec<InputType, Key>;
};

export function validateToolSpec<
  InputType extends Record<string, unknown>,
  Keys extends keyof InputType,
>(spec: ToolSpec<InputType, Keys>): void {
  // Cycle detection on requires graph
  const flowLike: Record<
    string,
    { requires: string[]; influencedBy: string[]; description: string }
  > = {};
  for (const key of Object.keys(spec) as Keys[]) {
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

/**
 * Topologically sort fields based on `requires` dependencies.
 * - Nodes with no `requires` come first.
 * - Among ready nodes (in-degree 0), prefer those with fewer `influencedBy` entries,
 *   then break ties deterministically by key name.
 */
export function toposortFields<
  S extends Record<string, { requires: readonly string[]; influencedBy?: readonly string[] }>,
>(spec: S): (keyof S)[] {
  const keys = Object.keys(spec) as (keyof S)[];
  const inDegree = new Map<keyof S, number>();
  const dependents = new Map<keyof S, (keyof S)[]>();

  // Initialize structures
  for (const k of keys) {
    inDegree.set(k, (spec[k].requires as (keyof S)[]).length);
    dependents.set(k, []);
  }

  // Build adjacency: r -> k for each k.requires includes r
  for (const k of keys) {
    for (const r of spec[k].requires as unknown as (keyof S)[]) {
      const arr = dependents.get(r)!;
      arr.push(k);
    }
  }

  // Helper to sort ready set by tie-breakers
  const sortReady = (a: keyof S, b: keyof S) => {
    const aInf = spec[a].influencedBy?.length ?? 0;
    const bInf = spec[b].influencedBy?.length ?? 0;
    if (aInf !== bInf) return aInf - bInf; // fewer influencedBy first
    const aKey = String(a);
    const bKey = String(b);
    return aKey.localeCompare(bKey);
  };

  const ready: (keyof S)[] = keys.filter(k => (inDegree.get(k) ?? 0) === 0).sort(sortReady);
  const order: (keyof S)[] = [];

  while (ready.length > 0) {
    const current = ready.shift()!;
    order.push(current);
    for (const dep of dependents.get(current)!) {
      const nextDeg = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, nextDeg);
      if (nextDeg === 0) {
        // insert keeping order by tie-breaker
        ready.push(dep);
        ready.sort(sortReady);
      }
    }
  }

  // Ackchually we don't need this, because we have checked for cycles on init.
  // Let's just hope the passed objects are not treated as m*table by the users
  if (order.length !== keys.length) {
    throw new Error('Cycle detected or missing nodes during toposort');
  }
  return order;
}

export function compileFixup<D extends Record<string, unknown>, DynamicFields extends keyof D>(
  spec: ToolSpec<D, DynamicFields>,
  dynamicFields: readonly DynamicFields[],
) {
  // Local type aliases for cleaner types
  type ValidationMap = { [P in keyof D]?: ParameterFeedback<D, P> };
  type ReqKeys<K extends DynamicFields> = FieldSpec<D, K>['requires'][number];
  type InfKeys<K extends DynamicFields> = FieldSpec<D, K>['influencedBy'][number];
  // Context includes requires, influencedBy, and static fields (computed at runtime)
  // We use a more permissive type here since static fields are determined at runtime
  type ContextFor<K extends DynamicFields> = Pick<D, ReqKeys<K>> &
    Partial<Pick<D, InfKeys<K>>> &
    Partial<D>;

  const dynamicSet = new Set(dynamicFields);

  function initializeStaticFields(
    loose: DynamicInputType<D, DynamicFields>,
    validFields: Partial<D>,
  ): void {
    // Seed static fields (non-dynamic) into context immediately. They are always available.
    // Extract all keys from the input, filter out dynamic fields
    // Cast to Partial<D> for iteration since DynamicInputType doesn't have index signature
    const loosePartial = loose as Partial<D>;
    for (const k in loosePartial) {
      const key = k as keyof D;
      if (!dynamicSet.has(key as DynamicFields)) {
        // Static fields are required in DynamicInputType, so safe to access
        const v = loosePartial[key];
        if (typeof v !== 'undefined') {
          validFields[key] = v as D[typeof key];
        }
      }
    }
  }

  function getDynamicFieldsInOrder(): DynamicFields[] {
    // Use topologically sorted keys based on requires/influencedBy prioritization.
    // Spec only contains dynamic fields, so all keys in spec are dynamic.
    const topoKeys = toposortFields(
      spec as Record<string, { requires: readonly string[]; influencedBy?: readonly string[] }>,
    );
    return topoKeys as DynamicFields[];
  }

  function buildContext<K extends DynamicFields>(
    rule: FieldSpec<D, K>,
    fieldKey: K,
    validFields: Partial<D>,
  ): ContextFor<K> {
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
      const key = staticKey as keyof D;
      if (key === fieldKey) continue; // Skip the current field
      if (!dynamicSet.has(key as DynamicFields)) {
        const v = validFields[key];
        if (typeof v !== 'undefined') {
          contextEntries.push([String(key), v]);
        }
      }
    }

    return Object.fromEntries(contextEntries) as ContextFor<K>;
  }

  function recordMissingRequirements<K extends DynamicFields>(
    rule: FieldSpec<D, K>,
    fieldKey: K,
    validFields: Partial<D>,
    validationResults: ValidationMap,
  ): boolean {
    // A field is ready only if all requires are valid.
    const requiresReady = rule.requires.every(dep => typeof validFields[dep] !== 'undefined');

    // Skip if any required fields are missing.
    if (!requiresReady) {
      const missing = rule.requires.filter(dep => typeof validFields[dep] === 'undefined');
      log('fixup:skip (missing requirements)', { field: fieldKey, missing });
      if (missing.length > 0) {
        validationResults[fieldKey] = {
          valid: false,
          requiresValidParameters: missing as unknown as NonEmptyArray<keyof D>,
        } as ParameterFeedback<D, K>;
      }
      return false;
    }
    return true;
  }

  function processValidationResult<K extends DynamicFields>(
    fieldKey: K,
    value: D[K] | undefined,
    validationResult: ParameterFeedback<D, K>,
    validFields: Partial<D>,
  ): void {
    // hotpatch it right away - we don't want to bother the LLM with no-op normalizations
    if (isDeepStrictEqual(value, validationResult.normalizedValue)) {
      delete validationResult.normalizedValue;
    }
    if (validationResult.valid) {
      if (typeof validationResult.normalizedValue !== 'undefined') {
        validFields[fieldKey] = validationResult.normalizedValue;
      } else {
        validFields[fieldKey] = value;
      }
    }
  }

  async function fixup(loose: DynamicInputType<D, DynamicFields>): Promise<ToolCallResult<D>> {
    log('fixup:start', loose);
    // Validation results for all fields.
    const validationResults: ValidationMap = {};

    // Overwrites for normalized RETURN values (from validate). Not every field's validate() returns a normalized value.
    // Some of the values are accepted as is, without normalization.
    const validFields: Partial<D> = {};

    initializeStaticFields(loose, validFields);
    const keys = getDynamicFieldsInOrder();

    for (const k of keys) {
      type Key = typeof k;
      type Value = D[Key];

      const rule: FieldSpec<D, Key> = spec[k];
      // Dynamic fields are optional in DynamicInputType
      const value: Value | undefined = (loose as Partial<D>)[k];

      if (!recordMissingRequirements(rule, k, validFields, validationResults)) {
        continue;
      }

      const context = buildContext(rule, k, validFields);
      const validationResult = await rule.validate(value, context);

      processValidationResult(k, value, validationResult, validFields);

      log('fixup:validate:', {
        field: k,
        value,
        context,
        validationResult,
      });
      validationResults[k] = validationResult as ParameterFeedback<D, Key>;
    }

    // Decide outcome (consider only dynamic fields)
    const allValidOrSkipped = keys.every(k => validationResults[k]?.valid !== false);

    if (!allValidOrSkipped) {
      const res = { status: 'rejected', validationResults } as ToolCallRejected<D>;
      log('fixup:rejected', JSON.stringify(res, null, 2));
      return res;
    }

    const res = { status: 'accepted', value: validFields as D } as ToolCallAccepted<D>;
    log('fixup:accepted', JSON.stringify(res, null, 2));
    return res;
  }

  return fixup;
}
