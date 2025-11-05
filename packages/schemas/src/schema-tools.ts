import { type ZodType, z } from 'zod';
import type { NonEmptyArray, AtLeastOne, AtMostOne } from '@tool2agent/types';

/**
 * Tagged schema types that explicitly mark whether a schema is an object or union
 * These wrapper objects avoid the need to access Zod's internal _def property
 */
export type TaggedObjectSchema<T extends z.ZodObject<z.ZodRawShape>> = {
  type: 'object';
  schema: T;
};

export type TaggedUnionSchema<
  T extends z.ZodUnion<[z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>,
> = {
  type: 'union';
  schema: T;
  branches: z.ZodTypeAny[];
};

export type TaggedSchema<
  T extends
    | z.ZodObject<z.ZodRawShape>
    | z.ZodUnion<[z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]> =
    | z.ZodObject<z.ZodRawShape>
    | z.ZodUnion<[z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>,
> =
  | TaggedObjectSchema<Extract<T, z.ZodObject<z.ZodRawShape>>>
  | TaggedUnionSchema<Extract<T, z.ZodUnion<[z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>>>;

/**
 * Helper to create a tagged object schema
 */
export function tagObject<T extends z.ZodObject<z.ZodRawShape>>(schema: T): TaggedObjectSchema<T> {
  return { type: 'object', schema };
}

/**
 * Helper to create a tagged union schema
 */
export function tagUnion<T extends z.ZodUnion<[z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>>(
  schema: T,
  branches: z.ZodTypeAny[],
): TaggedUnionSchema<T> {
  return { type: 'union', schema, branches };
}

/**
 * Helper to extract the schema from a tagged schema
 */
export function untag<T extends TaggedSchema>(tagged: T): z.ZodTypeAny {
  return tagged.schema;
}

/**
 * Returns the union branches of a tagged schema.
 * If the tagged schema is an object, returns a single-element array with that object.
 */
export function getUnionBranches(tagged: TaggedSchema): z.ZodTypeAny[] {
  return (tagged as unknown as { type: string }).type === 'union'
    ? (tagged as TaggedUnionSchema<z.ZodUnion<[z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>>)
        .branches
    : [(tagged as TaggedObjectSchema<z.ZodObject<z.ZodRawShape>>).schema];
}

/**
 * Creates a Zod schema where at most one of the provided keys can be present.
 * Corresponds to AtMostOne type from types.ts
 */
type AtMostOneOutput<TShape extends Record<string, ZodType<unknown>>> = AtMostOne<{
  [K in keyof TShape]?: z.infer<TShape[K]>;
}>;

export function atMostOne<TShape extends Record<string, ZodType<unknown>>>(
  schemas: TShape,
): z.ZodType<AtMostOneOutput<TShape>> {
  const keys = Object.keys(schemas) as (keyof TShape)[];
  const unionBranches = keys.map(key => {
    const branch: Record<string, ZodType<unknown>> = {};
    branch[key as string] = schemas[key];
    return z.object(branch).strict();
  });
  // Add empty object branch (none present)
  unionBranches.push(z.object({}).strict());
  return z.union(unionBranches as unknown as z.ZodTypeAny[]) as z.ZodType<AtMostOneOutput<TShape>>;
}

/**
 * Tagged version of atMostOne that returns a TaggedUnionSchema
 */
export function atMostOneTagged<TShape extends Record<string, ZodType<unknown>>>(
  schemas: TShape,
): TaggedUnionSchema<z.ZodUnion<[z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>> {
  const keys = Object.keys(schemas) as (keyof TShape)[];
  const unionBranches = keys.map(key => {
    const branch: Record<string, ZodType<unknown>> = {};
    branch[key as string] = schemas[key];
    return z.object(branch).strict();
  });
  // Add empty object branch (none present)
  unionBranches.push(z.object({}).strict());
  const unionSchema = z.union(
    unionBranches as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
  );
  return tagUnion(unionSchema, unionBranches);
}

/**
 * Creates a Zod schema where at least one of the provided keys must be present.
 * Corresponds to AtLeastOne type from types.ts
 */
type AtLeastOneOutput<TShape extends Record<string, ZodType<unknown>>> = AtLeastOne<{
  [K in keyof TShape]?: z.infer<TShape[K]>;
}>;

export function atLeastOne<TShape extends Record<string, ZodType<unknown>>>(
  schemas: TShape,
): z.ZodType<AtLeastOneOutput<TShape>> {
  const keys = Object.keys(schemas) as (keyof TShape)[];
  // Generate all combinations where at least one key is present
  // For each key, create a branch where that key is required and others are optional
  const unionBranches = keys.map(key => {
    const branch: Record<string, ZodType<unknown>> = {};
    branch[key as string] = schemas[key];
    // Add other keys as optional
    for (const otherKey of keys) {
      if (otherKey !== key) {
        branch[otherKey as string] = schemas[otherKey].optional();
      }
    }
    return z.object(branch).strict();
  });
  return z.union(unionBranches as unknown as z.ZodTypeAny[]) as z.ZodType<AtLeastOneOutput<TShape>>;
}

/**
 * Tagged version of atLeastOne that returns a TaggedUnionSchema
 */
export function atLeastOneTagged<TShape extends Record<string, ZodType<unknown>>>(
  schemas: TShape,
): TaggedUnionSchema<z.ZodUnion<[z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>> {
  const keys = Object.keys(schemas) as (keyof TShape)[];
  // Generate all combinations where at least one key is present
  const unionBranches = keys.map(key => {
    const branch: Record<string, ZodType<unknown>> = {};
    branch[key as string] = schemas[key];
    // Add other keys as optional
    for (const otherKey of keys) {
      if (otherKey !== key) {
        branch[otherKey as string] = schemas[otherKey].optional();
      }
    }
    return z.object(branch).strict();
  });
  const unionSchema = z.union(
    unionBranches as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
  );
  return tagUnion(unionSchema, unionBranches);
}

/**
 * Custom intersection function that knows whether schemas are objects or unions
 * Uses tagged wrappers to avoid accessing _def
 * Preserves precise types throughout
 */
export function intersectSchemas<
  TLeft extends
    | z.ZodObject<z.ZodRawShape>
    | z.ZodUnion<[z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>,
  TRight extends
    | z.ZodObject<z.ZodRawShape>
    | z.ZodUnion<[z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>,
>(
  left: TaggedSchema<TLeft>,
  right: TaggedSchema<TRight>,
): TaggedSchema<
  z.ZodObject<z.ZodRawShape> | z.ZodUnion<[z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>
> {
  if (left.type === 'object' && right.type === 'object') {
    // Both are objects: use extend to merge shapes
    const mergedObject = left.schema.extend(right.schema.shape).strict();
    // Return a tagged object schema directly (no union) to preserve exact type identity
    return tagObject(mergedObject);
  }

  if (left.type === 'object' && right.type === 'union') {
    // Object intersected with union: distribute over union branches
    const resultBranches = right.branches.map(branch => {
      if (branch instanceof z.ZodObject) {
        return left.schema.extend(branch.shape).strict();
      }
      return z.intersection(left.schema, branch);
    });
    return tagUnion(
      z.union(resultBranches as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]),
      resultBranches,
    );
  }

  if (left.type === 'union' && right.type === 'object') {
    // Union intersected with object: distribute over union branches
    const resultBranches = left.branches.map(branch => {
      if (branch instanceof z.ZodObject) {
        return right.schema.extend(branch.shape).strict();
      }
      return z.intersection(branch, right.schema);
    });
    return tagUnion(
      z.union(resultBranches as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]),
      resultBranches,
    );
  }

  if (left.type === 'union' && right.type === 'union') {
    // Union intersected with union: distribute over both (cartesian product)
    const resultBranches = left.branches.flatMap(leftBranch =>
      right.branches.map(rightBranch => {
        if (leftBranch instanceof z.ZodObject && rightBranch instanceof z.ZodObject) {
          return leftBranch.extend(rightBranch.shape).strict();
        }
        return z.intersection(leftBranch, rightBranch);
      }),
    );
    return tagUnion(
      z.union(resultBranches as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]),
      resultBranches,
    );
  }

  // Fallback: shouldn't happen with our tagged types
  throw new Error('Unexpected schema types in intersection');
}

export const nonEmptyArray = <T extends ZodType<unknown>>(
  itemSchema: T,
): z.ZodType<NonEmptyArray<z.infer<T>>> =>
  z
    .array(itemSchema)
    .min(1, { message: 'Array must contain at least one element' }) as unknown as z.ZodType<
    NonEmptyArray<z.infer<T>>
  >;
