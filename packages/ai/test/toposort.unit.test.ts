import { expect } from 'chai';
import { describe, it } from 'mocha';
import { validateToolSpec, type ToolSpec } from '../src/index.js';
import { toposortFields } from '../src/graph.js';

describe('validation.toposortFields', () => {
  it('orders by requires dependencies, roots first', () => {
    type D = { a: number; b: number; c: number; d: number };
    const spec: ToolSpec<D> = {
      a: { requires: [], validate: async () => ({ valid: true }) },
      b: { requires: ['a'], validate: async () => ({ valid: true }) },
      c: { requires: ['b'], validate: async () => ({ valid: true }) },
      d: { requires: ['b', 'c'], validate: async () => ({ valid: true }) },
    };
    validateToolSpec(spec);
    const order = toposortFields(spec);
    // a must be before b; b before c and d; c before d
    const pos = (k: keyof typeof spec) => order.indexOf(k);
    expect(pos('a')).to.be.lessThan(pos('b'));
    expect(pos('b')).to.be.lessThan(pos('c'));
    expect(pos('c')).to.be.lessThan(pos('d'));
  });

  it('breaks ties by key name alphabetically', () => {
    type D = { a: number; b: number; c: number; d: number };
    const spec: ToolSpec<D> = {
      a: { requires: [], validate: async () => ({ valid: true }) },
      b: { requires: [], validate: async () => ({ valid: true }) },
      c: { requires: [], validate: async () => ({ valid: true }) },
      d: { requires: [], validate: async () => ({ valid: true }) },
    };
    validateToolSpec(spec);
    const order = toposortFields(spec);
    // All have no requires, so should be sorted alphabetically
    expect(order).to.deep.equal(['a', 'b', 'c', 'd']);
  });

  it('handles parallel branches correctly', () => {
    type D = { a: number; b: number; c: number; d: number; e: number };
    const spec: ToolSpec<D> = {
      a: { requires: [], validate: async () => ({ valid: true }) },
      b: { requires: ['a'], validate: async () => ({ valid: true }) },
      c: { requires: ['a'], validate: async () => ({ valid: true }) },
      d: { requires: ['b'], validate: async () => ({ valid: true }) },
      e: { requires: ['c'], validate: async () => ({ valid: true }) },
    };
    validateToolSpec(spec);
    const order = toposortFields(spec);
    const pos = (k: keyof D) => order.indexOf(k);
    // a before b and c; b before d; c before e
    const got = {
      order,
      aBefore: { b: pos('a') < pos('b'), c: pos('a') < pos('c') },
      bBeforeD: pos('b') < pos('d'),
      cBeforeE: pos('c') < pos('e'),
    };
    expect(got).to.deep.equal({
      order,
      aBefore: { b: true, c: true },
      bBeforeD: true,
      cBeforeE: true,
    });
  });

  it('sorts nodes with same dependencies alphabetically', () => {
    type D = { a: number; b: number; c: number };
    const spec: ToolSpec<D> = {
      a: { requires: [], validate: async () => ({ valid: true }) },
      b: { requires: ['a'], validate: async () => ({ valid: true }) },
      c: { requires: ['a'], validate: async () => ({ valid: true }) },
    };
    validateToolSpec(spec);
    const order = toposortFields(spec);
    expect(order).to.deep.equal(['a', 'b', 'c']);
  });
});
