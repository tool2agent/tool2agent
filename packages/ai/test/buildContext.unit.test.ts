import { expect } from 'chai';
import { describe, it } from 'mocha';
import { buildContext, type ToolFieldConfig } from '../src/index.js';

describe('buildContext', () => {
  type TestInput = {
    a: string;
    b: number;
    c: boolean;
    d: string;
    e: number;
  };

  it('includes required fields', () => {
    const rule: ToolFieldConfig<TestInput, 'c'> = {
      requires: ['a', 'b'],
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

  it('includes other dynamic fields when present', () => {
    const rule: ToolFieldConfig<TestInput, 'c'> = {
      requires: ['a'],
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

  it('excludes other dynamic fields when missing', () => {
    const rule: ToolFieldConfig<TestInput, 'c'> = {
      requires: ['a'],
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
    const rule: ToolFieldConfig<TestInput, 'c'> = {
      requires: [],
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
    const rule: ToolFieldConfig<TestInput, 'c'> = {
      requires: [],
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

  it('includes dynamic fields as optional in context', () => {
    const rule: ToolFieldConfig<TestInput, 'c'> = {
      requires: [],
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
        a: 'dynamic-a',
        b: 42,
        d: 'static-d',
        e: 100,
      },
    });
  });

  it('combines required, other dynamic fields, and static fields', () => {
    const rule: ToolFieldConfig<TestInput, 'c'> = {
      requires: ['a'],
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
    const rule: ToolFieldConfig<TestInput, 'c'> = {
      requires: ['a', 'b'],
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
