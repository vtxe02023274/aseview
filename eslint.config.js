import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'site'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['tools/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', Buffer: 'readonly', URL: 'readonly' } },
  },
);
