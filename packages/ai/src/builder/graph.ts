export function detectRequiresCycles(spec: Record<string, { requires: string[] }>): string[][] {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(node: string, path: string[]) {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      cycles.push(path.slice(cycleStart));
      return;
    }

    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);

    const requires = spec[node]?.requires ?? [];
    for (const neighbor of requires) {
      dfs(neighbor, [...path, node]);
    }

    inStack.delete(node);
  }

  for (const key of Object.keys(spec)) {
    dfs(key, []);
  }

  return cycles;
}

/**
 * Topologically sort fields based on `requires` dependencies.
 * - Nodes with no `requires` come first.
 * - Break ties deterministically by key name.
 */
export function toposortFields<S extends Record<string, { requires: readonly string[] }>>(
  spec: S,
): (keyof S)[] {
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
      const arr = dependents.get(r);
      if (arr) {
        arr.push(k);
      }
    }
  }

  // Helper to sort ready set by tie-breaker (alphabetical order)
  const sortReady = (a: keyof S, b: keyof S) => {
    const aKey = String(a);
    const bKey = String(b);
    return aKey.localeCompare(bKey);
  };

  const ready: (keyof S)[] = keys.filter(k => (inDegree.get(k) ?? 0) === 0).sort(sortReady);
  const order: (keyof S)[] = [];

  while (ready.length > 0) {
    const current = ready.shift();
    if (!current) break;
    order.push(current);
    const deps = dependents.get(current);
    if (deps) {
      for (const dep of deps) {
        const nextDeg = (inDegree.get(dep) ?? 0) - 1;
        inDegree.set(dep, nextDeg);
        if (nextDeg === 0) {
          // insert keeping order by tie-breaker
          ready.push(dep);
          ready.sort(sortReady);
        }
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
