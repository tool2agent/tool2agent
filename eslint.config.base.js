import tseslint from 'typescript-eslint';
import js from '@eslint/js';

// Base config shared across packages
export const baseConfig = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map(config => ({
    ...config,
    files: ['**/src/**/*.ts'],
  })),
  {
    files: ['**/src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
    },
  },
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/dist-cjs/**'],
  },
);
