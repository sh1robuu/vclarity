import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
export default ts.config(
  { ignores: ['**/node_modules/**', '**/.wxt/**', '**/.output/**', '**/dist/**', '**/test-results/**', '**/playwright-report/**'] },
  js.configs.recommended, ...ts.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node, chrome: 'readonly', defineBackground: 'readonly', defineUnlistedScript: 'readonly' } }, rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } }
);
