import { expect } from 'chai';
import { describe, it } from 'mocha';
import { validateToolSpec, toposortFields, type ToolSpec } from '../src/validation.js';

describe('validation.toposortFields', () => {
  it('orders by requires dependencies, roots first', () => {
    type D = { a: number; b: number; c: number; d: number };
    const spec: ToolSpec<D> = {
      a: { requires: [], influencedBy: [], validate: async () => ({ valid: true }) },
      b: { requires: ['a'], influencedBy: [], validate: async () => ({ valid: true }) },
      c: { requires: ['b'], influencedBy: [], validate: async () => ({ valid: true }) },
      d: { requires: ['b', 'c'], influencedBy: [], validate: async () => ({ valid: true }) },
    };
    validateToolSpec(spec);
    const order = toposortFields(spec);
    // a must be before b; b before c and d; c before d
    const pos = (k: keyof typeof spec) => order.indexOf(k);
    expect(pos('a')).to.be.lessThan(pos('b'));
    expect(pos('b')).to.be.lessThan(pos('c'));
    expect(pos('c')).to.be.lessThan(pos('d'));
  });

  it('breaks ties by fewer influencedBy, then key name', () => {
    type D = { a: number; b: number; c: number; d: number };
    const spec: ToolSpec<D> = {
      a: { requires: [], influencedBy: ['b', 'c', 'd'], validate: async () => ({ valid: true }) },
      b: { requires: [], influencedBy: ['c'], validate: async () => ({ valid: true }) },
      c: { requires: [], influencedBy: [], validate: async () => ({ valid: true }) },
      d: { requires: [], influencedBy: [], validate: async () => ({ valid: true }) },
    };
    validateToolSpec(spec);
    const order = toposortFields(spec);
    // c and d both have 0 influencedBy; alphabetical: c before d
    // b has 1 influencedBy
    // a has 3 influencedBy
    const expectedFirstTwo = new Set(['c', 'd']);
    expect(new Set(order.slice(0, 2))).to.deep.equal(expectedFirstTwo);
    expect(order.indexOf('b')).to.be.greaterThan(order.indexOf('d'));
    expect(order.indexOf('a')).to.be.greaterThan(order.indexOf('b'));
  });

  it('handles parallel branches correctly', () => {
    type D = { a: number; b: number; c: number; d: number; e: number };
    const spec: ToolSpec<D> = {
      a: { requires: [], influencedBy: [], validate: async () => ({ valid: true }) },
      b: { requires: ['a'], influencedBy: [], validate: async () => ({ valid: true }) },
      c: { requires: ['a'], influencedBy: [], validate: async () => ({ valid: true }) },
      d: { requires: ['b'], influencedBy: [], validate: async () => ({ valid: true }) },
      e: { requires: ['c'], influencedBy: [], validate: async () => ({ valid: true }) },
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

  it('prioritizes absence of influencedBy', () => {
    type D = { a: number; b: number; c: number };
    const spec: ToolSpec<D> = {
      a: { requires: [], influencedBy: [], validate: async () => ({ valid: true }) },
      b: { requires: ['a'], influencedBy: ['c'], validate: async () => ({ valid: true }) },
      c: { requires: ['a'], influencedBy: [], validate: async () => ({ valid: true }) },
    };
    validateToolSpec(spec);
    const order = toposortFields(spec);
    expect(order).to.deep.equal(['a', 'c', 'b']);
  });
});
