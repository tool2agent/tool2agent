import tseslint from 'typescript-eslint';
import js from '@eslint/js';

// Root config - just handles root-level files and delegates to packages
export default tseslint.config(js.configs.recommended, {
  ignores: [
    '**/node_modules/**',
    '**/dist/**',
    '**/dist-cjs/**',
    '**/docs/**',
    '**/.github/**',
    '**/pnpm-lock.yaml',
    '**/scripts/**',
    '**/examples/**',
    '**/test/**',
    '**/test-d/**',
    '**/*.test.ts',
    '**/*.test-d.ts',
    'packages/**', // Delegate to package configs
  ],
});
