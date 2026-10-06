import globals from 'globals';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';

const unusedRule = [
  'error',
  {
    argsIgnorePattern: '^_',
    caughtErrorsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
  },
];

export default [
  {
    name: 'nexus/ignores',
    ignores: ['**/dist/**', '**/node_modules/**', '**/data/**'],
  },
  {
    name: 'nexus/agent-typescript',
    files: [
      'packages/backend/src/modules/agent/**/*.ts',
      'packages/backend/src/infrastructure/agent/**/*.ts',
      'packages/backend/src/interfaces/http/agent/**/*.ts',
      'packages/backend/src/interfaces/websocket/agent*.ts',
      'packages/agent-runner/src/**/*.ts',
      'tests/backend/agent-scenarios/**/*.ts',
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-unused-vars': unusedRule,
    },
  },
  ...vue.configs['flat/essential'],
  {
    name: 'nexus/frontend-typescript',
    files: ['packages/frontend/src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-unused-vars': unusedRule,
    },
  },
  {
    name: 'nexus/frontend-vue',
    files: ['packages/frontend/src/**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module' },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-unused-vars': unusedRule,
      'vue/no-mutating-props': ['error', { shallowOnly: true }],
      'vue/no-use-v-if-with-v-for': 'error',
    },
  },
];
