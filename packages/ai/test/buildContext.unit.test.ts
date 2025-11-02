import { expect } from 'chai';
import { describe, it } from 'mocha';
import { buildContext, type FieldSpec } from '../src/validation.js';

describe('buildContext', () => {
  type TestInput = {
    a: string;
    b: number;
    c: boolean;
    d: string;
    e: number;
  };

  it('includes required fields', () => {
    const rule: FieldSpec<TestInput, 'c'> = {
      requires: ['a', 'b'],
      influencedBy: [],
      validate: async () => ({ valid: true }),
    };
    const validFields: Partial<TestInput> = {
      a: 'value-a',
      b: 42,
    };
    const dynamicSet = new Set<keyof TestInput>(['a', 'b', 'c']);

    const result = buildContext(rule, 'c', validFields, dynamicSet);

    expect(result).to.deep.equal({
      success: true,
      context: {
        a: 'value-a',
        b: 42,
      },
    });
  });

  it('includes influencedBy fields when present', () => {
    const rule: FieldSpec<TestInput, 'c'> = {
      requires: ['a'],
      influencedBy: ['b'],
      validate: async () => ({ valid: true }),
    };
    const validFields: Partial<TestInput> = {
      a: 'value-a',
      b: 42,
    };
    const dynamicSet = new Set<keyof TestInput>(['a', 'b', 'c']);

    const result = buildContext(rule, 'c', validFields, dynamicSet);

    expect(result).to.deep.equal({
      success: true,
      context: {
        a: 'value-a',
        b: 42,
      },
    });
  });

  it('excludes influencedBy fields when missing', () => {
    const rule: FieldSpec<TestInput, 'c'> = {
      requires: ['a'],
      influencedBy: ['b'],
      validate: async () => ({ valid: true }),
    };
    const validFields: Partial<TestInput> = {
      a: 'value-a',
      // b is missing
    };
    const dynamicSet = new Set<keyof TestInput>(['a', 'b', 'c']);

    const result = buildContext(rule, 'c', validFields, dynamicSet);

    expect(result).to.deep.equal({
      success: true,
      context: {
        a: 'value-a',
      },
    });
  });

  it('includes static fields', () => {
    const rule: FieldSpec<TestInput, 'c'> = {
      requires: [],
      influencedBy: [],
      validate: async () => ({ valid: true }),
    };
    const validFields: Partial<TestInput> = {
      d: 'static-d',
      e: 100,
    };
    const dynamicSet = new Set<keyof TestInput>(['a', 'b', 'c']); // d and e are static

    const result = buildContext(rule, 'c', validFields, dynamicSet);

    expect(result).to.deep.equal({
      success: true,
      context: {
        d: 'static-d',
        e: 100,
      },
    });
  });

  it('excludes current field from context', () => {
    const rule: FieldSpec<TestInput, 'c'> = {
      requires: [],
      influencedBy: [],
      validate: async () => ({ valid: true }),
    };
    const validFields: Partial<TestInput> = {
      c: true, // current field
      d: 'static-d',
    };
    const dynamicSet = new Set<keyof TestInput>(['a', 'b', 'c']);

    const result = buildContext(rule, 'c', validFields, dynamicSet);

    expect(result).to.deep.equal({
      success: true,
      context: {
        d: 'static-d',
      },
    });
  });

  it('excludes dynamic fields from static fields', () => {
    const rule: FieldSpec<TestInput, 'c'> = {
      requires: [],
      influencedBy: [],
      validate: async () => ({ valid: true }),
    };
    const validFields: Partial<TestInput> = {
      a: 'dynamic-a',
      b: 42,
      d: 'static-d',
      e: 100,
    };
    const dynamicSet = new Set<keyof TestInput>(['a', 'b', 'c']); // a and b are dynamic

    const result = buildContext(rule, 'c', validFields, dynamicSet);

    expect(result).to.deep.equal({
      success: true,
      context: {
        d: 'static-d',
        e: 100,
      },
    });
  });

  it('combines required, influencedBy, and static fields', () => {
    const rule: FieldSpec<TestInput, 'c'> = {
      requires: ['a'],
      influencedBy: ['b'],
      validate: async () => ({ valid: true }),
    };
    const validFields: Partial<TestInput> = {
      a: 'required-a',
      b: 42,
      d: 'static-d',
      e: 100,
    };
    const dynamicSet = new Set<keyof TestInput>(['a', 'b', 'c']);

    const result = buildContext(rule, 'c', validFields, dynamicSet);

    expect(result).to.deep.equal({
      success: true,
      context: {
        a: 'required-a',
        b: 42,
        d: 'static-d',
        e: 100,
      },
    });
  });

  it('returns missingRequirements when required fields are missing', () => {
    const rule: FieldSpec<TestInput, 'c'> = {
      requires: ['a', 'b'],
      influencedBy: [],
      validate: async () => ({ valid: true }),
    };
    const validFields: Partial<TestInput> = {
      a: 'value-a',
      // b is missing
    };
    const dynamicSet = new Set<keyof TestInput>(['a', 'b', 'c']);

    const result = buildContext(rule, 'c', validFields, dynamicSet);

    expect(result).to.deep.equal({
      success: false,
      missingRequirements: ['b'],
    });
  });
});
