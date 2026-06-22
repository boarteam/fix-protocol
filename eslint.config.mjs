import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Flat ESLint config for the monorepo. typescript-eslint's recommended rules, with
 * formatting left entirely to Prettier (`eslint-config-prettier` turns off the overlapping
 * rules). Generated data files are not linted.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'packages/fix-dict-fix44/src/dictionary.json',
      'packages/fix-dict-fix44/src/index.ts', // generated
      'docs/**',
    ],
  },
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // The codebase deliberately uses non-null assertions where an invariant guarantees
      // presence (e.g. regex group captures, just-checked map lookups); they are reviewed.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Tests and scripts may use a few looser patterns.
    files: ['**/*.test.ts', 'scripts/**', 'examples/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
