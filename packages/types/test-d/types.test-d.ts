import { type NonEmptyArray } from '../src/types.js';

// The purpose of this file is to assert compile-time types only (no runtime).

// ==================== NonEmptyArray Tests ====================

// Valid: NonEmptyArray with at least one element
const validNonEmptyArray: NonEmptyArray<string> = ['first'];
const validNonEmptyArray2: NonEmptyArray<number> = [1, 2, 3];

// Invalid: Empty array should not be allowed
// @ts-expect-error - empty array is not a NonEmptyArray
const invalidEmpty: NonEmptyArray<string> = [];
