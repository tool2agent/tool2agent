import { expect } from 'chai';
import { describe, it } from 'mocha';
import { type ToolSpec } from '../src/index.js';
import { validateToolSpec } from '../src/builder/validation.js';
import { detectRequiresCycles } from '../src/builder/graph.js';

describe('cycle detection in builder', () => {
  describe('detectRequiresCycles', () => {
    it('detects simple 2-node cycle (a -> b -> a)', () => {
      const spec: Record<string, { requires: string[] }> = {
        a: { requires: ['b'] },
        b: { requires: ['a'] },
      };
      const cycles = detectRequiresCycles(spec);
      expect(cycles.length).to.be.greaterThan(0);
      // Should detect cycle: a -> b -> a or b -> a -> b
      const cycleStrings = cycles.map(c => c.join(' -> '));
      expect(cycleStrings.some(c => c.includes('a') && c.includes('b'))).to.be.true;
    });

    it('detects longer cycle (a -> b -> c -> a)', () => {
      const spec: Record<string, { requires: string[] }> = {
        a: { requires: ['b'] },
        b: { requires: ['c'] },
        c: { requires: ['a'] },
      };
      const cycles = detectRequiresCycles(spec);
      expect(cycles.length).to.be.greaterThan(0);
      const cycleStrings = cycles.map(c => c.join(' -> '));
      expect(cycleStrings.some(c => c.includes('a') && c.includes('b') && c.includes('c'))).to.be
        .true;
    });

    it('detects self-referential cycle (a -> a)', () => {
      const spec: Record<string, { requires: string[] }> = {
        a: { requires: ['a'] },
      };
      const cycles = detectRequiresCycles(spec);
      expect(cycles.length).to.be.greaterThan(0);
      // For self-referential cycles, the cycle array contains the node
      // The cycle is detected when 'a' requires 'a', so we should have a cycle
      const cycleStrings = cycles.map(c => c.join(' -> '));
      // The cycle should contain 'a', and may be represented as ['a'] or ['a', 'a']
      expect(cycles.some(c => c.includes('a'))).to.be.true;
    });

    it('detects multiple cycles in the same graph', () => {
      const spec: Record<string, { requires: string[] }> = {
        a: { requires: ['b'] },
        b: { requires: ['a'] },
        c: { requires: ['d'] },
        d: { requires: ['c'] },
      };
      const cycles = detectRequiresCycles(spec);
      expect(cycles.length).to.be.greaterThan(1);
      const cycleStrings = cycles.map(c => c.join(' -> '));
      const hasABCycle = cycleStrings.some(c => c.includes('a') && c.includes('b'));
      const hasCDCycle = cycleStrings.some(c => c.includes('c') && c.includes('d'));
      expect(hasABCycle).to.be.true;
      expect(hasCDCycle).to.be.true;
    });

    it('detects cycle in complex graph with non-cyclic nodes', () => {
      const spec: Record<string, { requires: string[] }> = {
        a: { requires: [] },
        b: { requires: ['a'] },
        c: { requires: ['b'] },
        d: { requires: ['c'] },
        e: { requires: ['d'] }, // e -> d -> c -> b -> a (no cycle)
        f: { requires: ['g'] },
        g: { requires: ['f'] }, // f -> g -> f (cycle)
      };
      const cycles = detectRequiresCycles(spec);
      expect(cycles.length).to.be.greaterThan(0);
      const cycleStrings = cycles.map(c => c.join(' -> '));
      const hasFGCycle = cycleStrings.some(c => c.includes('f') && c.includes('g'));
      expect(hasFGCycle).to.be.true;
    });

    it('returns empty array for acyclic graph', () => {
      const spec: Record<string, { requires: string[] }> = {
        a: { requires: [] },
        b: { requires: ['a'] },
        c: { requires: ['b'] },
        d: { requires: ['a', 'c'] },
      };
      const cycles = detectRequiresCycles(spec);
      expect(cycles).to.deep.equal([]);
    });

    it('returns empty array for empty spec', () => {
      const spec: Record<string, { requires: string[] }> = {};
      const cycles = detectRequiresCycles(spec);
      expect(cycles).to.deep.equal([]);
    });

    it('handles nodes with no requires', () => {
      const spec: Record<string, { requires: string[] }> = {
        a: { requires: [] },
        b: { requires: [] },
        c: { requires: [] },
      };
      const cycles = detectRequiresCycles(spec);
      expect(cycles).to.deep.equal([]);
    });

    it('handles missing nodes in requires array', () => {
      const spec: Record<string, { requires: string[] }> = {
        a: { requires: ['nonexistent'] },
        b: { requires: ['a'] },
      };
      // Should not throw, but may or may not detect cycles depending on implementation
      const cycles = detectRequiresCycles(spec);
      // The function should handle this gracefully
      expect(cycles).to.be.an('array');
    });

    it('detects cycle with multiple dependencies per node', () => {
      const spec: Record<string, { requires: string[] }> = {
        a: { requires: ['b', 'c'] },
        b: { requires: ['a'] },
        c: { requires: ['a'] },
      };
      const cycles = detectRequiresCycles(spec);
      expect(cycles.length).to.be.greaterThan(0);
      const cycleStrings = cycles.map(c => c.join(' -> '));
      expect(cycleStrings.some(c => c.includes('a') && (c.includes('b') || c.includes('c')))).to.be
        .true;
    });
  });

  describe('validateToolSpec cycle detection', () => {
    it('throws error for simple 2-node cycle', () => {
      type Input = { a: string; b: string };
      const spec: ToolSpec<Input> = {
        a: { requires: ['b'], validate: async () => ({ valid: true }) },
        b: { requires: ['a'], validate: async () => ({ valid: true }) },
      };
      expect(() => validateToolSpec(spec)).to.throw('Cycle detected in requires graph');
    });

    it('throws error for longer cycle', () => {
      type Input = { a: string; b: string; c: string };
      const spec: ToolSpec<Input> = {
        a: { requires: ['b'], validate: async () => ({ valid: true }) },
        b: { requires: ['c'], validate: async () => ({ valid: true }) },
        c: { requires: ['a'], validate: async () => ({ valid: true }) },
      };
      expect(() => validateToolSpec(spec)).to.throw('Cycle detected in requires graph');
    });

    it('throws error for self-referential cycle', () => {
      type Input = { a: string };
      const spec: ToolSpec<Input> = {
        a: { requires: ['a' as any as never], validate: async () => ({ valid: true }) },
      };
      expect(() => validateToolSpec(spec)).to.throw('Cycle detected in requires graph');
    });

    it('throws error with cycle details in message', () => {
      type Input = { a: string; b: string };
      const spec: ToolSpec<Input> = {
        a: { requires: ['b'], validate: async () => ({ valid: true }) },
        b: { requires: ['a'], validate: async () => ({ valid: true }) },
      };
      try {
        validateToolSpec(spec);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        const err = error as Error;
        expect(err.message).to.include('Cycle detected in requires graph');
        expect(err.message).to.include('a');
        expect(err.message).to.include('b');
      }
    });

    it('does not throw for acyclic graph', () => {
      type Input = { a: string; b: string; c: string };
      const spec: ToolSpec<Input> = {
        a: { requires: [], validate: async () => ({ valid: true }) },
        b: { requires: ['a'], validate: async () => ({ valid: true }) },
        c: { requires: ['b'], validate: async () => ({ valid: true }) },
      };
      expect(() => validateToolSpec(spec)).to.not.throw();
    });

    it('does not throw for empty spec', () => {
      type Input = Record<string, never>;
      const spec: ToolSpec<Input> = {};
      expect(() => validateToolSpec(spec)).to.not.throw();
    });

    it('handles complex acyclic graph', () => {
      type Input = { a: string; b: string; c: string; d: string; e: string };
      const spec: ToolSpec<Input> = {
        a: { requires: [], validate: async () => ({ valid: true }) },
        b: { requires: ['a'], validate: async () => ({ valid: true }) },
        c: { requires: ['a'], validate: async () => ({ valid: true }) },
        d: { requires: ['b', 'c'], validate: async () => ({ valid: true }) },
        e: { requires: ['d'], validate: async () => ({ valid: true }) },
      };
      expect(() => validateToolSpec(spec)).to.not.throw();
    });

    it('detects cycle in complex graph with multiple paths', () => {
      type Input = { a: string; b: string; c: string; d: string };
      const spec: ToolSpec<Input> = {
        a: { requires: ['b'], validate: async () => ({ valid: true }) },
        b: { requires: ['c'], validate: async () => ({ valid: true }) },
        c: { requires: ['d'], validate: async () => ({ valid: true }) },
        d: { requires: ['a'], validate: async () => ({ valid: true }) }, // Creates cycle: a -> b -> c -> d -> a
      };
      expect(() => validateToolSpec(spec)).to.throw('Cycle detected in requires graph');
    });

    it('detects cycle when node has multiple dependencies and one creates cycle', () => {
      type Input = { a: string; b: string; c: string };
      const spec: ToolSpec<Input> = {
        a: { requires: ['b', 'c'], validate: async () => ({ valid: true }) },
        b: { requires: ['a'], validate: async () => ({ valid: true }) }, // Creates cycle: a -> b -> a
        c: { requires: [], validate: async () => ({ valid: true }) },
      };
      expect(() => validateToolSpec(spec)).to.throw('Cycle detected in requires graph');
    });
  });
});
