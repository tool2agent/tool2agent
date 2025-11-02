import { detectRequiresCycles } from './graph.js';
import { type ParameterFeedback, type NonEmptyArray, type ToolInputType } from '@tool2agent/types';
import { isDeepStrictEqual } from 'util';
import { log } from './internal-logger.js';

export type ToolCallAccepted<D extends ToolInputType> = {
  status: 'accepted';
  value: D;
};

export type ToolCallRejected<D extends ToolInputType> = {
  status: 'rejected';
  validationResults: { [K in keyof D]: ParameterFeedback<D, K> };
};

export type ToolCallResult<D extends ToolInputType> = ToolCallAccepted<D> | ToolCallRejected<D>;

export type FieldSpec<
  D extends ToolInputType,
  K extends keyof D,
  Requires extends Exclude<keyof D, K>[] = Exclude<keyof D, K>[],
  Influences extends Exclude<keyof D, K>[] = Exclude<keyof D, K>[],
> = {
  requires: Requires;
  influencedBy: Influences;
  description?: string;
  validate: (
    value: D[K] | undefined,
    context: Pick<D, Requires[number]> & Partial<Pick<D, Influences[number]>>,
  ) => Promise<ParameterFeedback<D, K>>;
};

export type ToolSpec<D extends ToolInputType> = {
  [K in keyof D]: FieldSpec<D, K>;
};

export function defineToolSpec<D extends ToolInputType>() {
  return <S extends ToolSpec<D>>(spec: S) => {
    // Cycle detection on requires graph
    const flowLike: any = {};
    for (const key of Object.keys(spec)) {
      flowLike[key] = {
        requires: spec[key as keyof S].requires as string[],
        influencedBy: spec[key as keyof S].influencedBy as string[],
        description: spec[key as keyof S].description ?? '',
      };
    }
    const cycles = detectRequiresCycles(flowLike);
    if (cycles.length > 0) {
      const msg = cycles.map(c => c.join(' -> ')).join('; ');
      throw new Error(`Cycle detected in requires graph: ${msg}`);
    }
    return spec;
  };
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

export function compileFixup<D extends ToolInputType>(spec: ToolSpec<D>) {
  // Local type aliases for cleaner types
  type ValidationMap = { [P in keyof D]?: ParameterFeedback<D, P> };
  type ReqKeys<K extends keyof D> = FieldSpec<D, K>['requires'][number];
  type InfKeys<K extends keyof D> = FieldSpec<D, K>['influencedBy'][number];
  type ContextFor<K extends keyof D> = Pick<D, ReqKeys<K>> & Partial<Pick<D, InfKeys<K>>>;

  async function fixup(loose: Partial<D>): Promise<ToolCallResult<D>> {
    log('fixup:start', loose);
    // Validation results for all fields.
    const validationResults: ValidationMap = {};

    // Overwrites for normalized RETURN values (from validate). Not every field's validate() returns a normalized value.
    // Some of the values are accepted as is, without normalization.
    const validFields: Partial<D> = {};

    // Use topologically sorted keys based on requires/influencedBy prioritization.
    const keys: (keyof D)[] = toposortFields(
      spec as Record<string, { requires: readonly string[]; influencedBy?: readonly string[] }>,
    );

    for (const k of keys) {
      type Key = typeof k;
      type Value = D[Key];

      const rule: FieldSpec<D, Key> = spec[k];
      const value: Value | undefined = loose[k];

      // A field is ready only if all requires are valid.
      const requiresReady = rule.requires.every(dep => typeof validFields[dep] !== 'undefined');

      // Skip if any required fields are missing.
      if (!requiresReady) {
        const missing = rule.requires.filter(dep => typeof validFields[dep] === 'undefined');
        log('fixup:skip (missing requirements)', { field: k, missing });
        if (missing.length > 0) {
          validationResults[k] = {
            valid: false,
            requiresValidParameters: missing as unknown as NonEmptyArray<keyof D>,
          } as ParameterFeedback<D, Key>;
        }
        continue;
      }

      const contextEntries: [string, unknown][] = [];
      for (const requiredContextField of rule.requires) {
        const v = validFields[requiredContextField];
        if (typeof v !== 'undefined') {
          contextEntries.push([String(requiredContextField), v]);
        }
      }
      for (const optionalContextField of rule.influencedBy) {
        const v = validFields[optionalContextField];
        if (typeof v !== 'undefined') {
          contextEntries.push([String(optionalContextField), v]);
        }
      }
      const context = Object.fromEntries(contextEntries) as ContextFor<Key>;
      const validationResult = await rule.validate(value, context);

      // hotpatch it right away - we don't want to bother the LLM with no-op normalizations
      if (isDeepStrictEqual(value, validationResult.normalizedValue)) {
        delete validationResult.normalizedValue;
      }
      if (validationResult.valid) {
        if (typeof validationResult.normalizedValue !== 'undefined') {
          validFields[k] = validationResult.normalizedValue;
        } else {
          validFields[k] = value;
        }
      }

      log('fixup:validate:', {
        field: k,
        value,
        context,
        validationResult,
      });
      validationResults[k] = validationResult as ParameterFeedback<D, Key>;
    }

    // Decide outcome
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
