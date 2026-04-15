const { FlatCompat } = require('@eslint/eslintrc');

const legacyConfig = require('./eslint.legacy-config.cjs');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  resolvePluginsRelativeTo: __dirname,
});

const ignores = [
  ...(legacyConfig.ignorePatterns || []),
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.vite/**',
  '*.min.js',
  '**/*.min.js',
  '**/packages/*/dist/**',
  '**/packages/*/build/**',
  '**/packages/*/coverage/**',
  'commitlint.config.js',
  '**/commitlint.config.js',
  'scripts/*.js',
  '**/scripts/*.js',
  'packages/frontend/public/sw.js',
  '**/packages/frontend/public/sw.js',
  'packages/frontend/lighthouse.config.js',
  '**/packages/frontend/lighthouse.config.js',
  '**/*.vue',
  '**/*.config.ts',
  'eslint.legacy-config.cjs',
  '**/eslint.legacy-config.cjs',
  '.prettierrc.js',
  '**/.prettierrc.js',
  '.lintstagedrc.js',
  '**/.lintstagedrc.js',
  'eslint.config.js',
  '**/eslint.config.js',
];

module.exports = [
  {
    ignores: [...new Set(ignores)],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  ...compat.config({
    ...legacyConfig,
    root: undefined,
    ignorePatterns: undefined,
  }),
];
