import typescriptParser from '@typescript-eslint/parser';
import vueParser from 'vue-eslint-parser';
import functionSpacing from './function-spacing.mjs';

export default [
	{
		name: 'nexus/format-ignores',
		ignores: [
			'**/node_modules/**',
			'**/dist/**',
			'**/dist-components/**',
			'**/coverage/**',
			'**/playwright-report/**',
			'**/test-results/**',
			'**/.vite/**',
			'**/.data/**',
			'**/.dev/**',
			'**/.artifacts/**',
		],
	},
	{
		name: 'nexus/function-spacing',
		files: ['**/*.{ts,tsx,js,jsx,mjs,cjs,vue}'],
		languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
		plugins: { 'nexus-style': functionSpacing },
		rules: { 'nexus-style/function-spacing': 'error' },
	},
	{
		name: 'nexus/typescript-parser',
		files: ['**/*.{ts,tsx}'],
		languageOptions: {
			parser: typescriptParser,
			parserOptions: { ecmaFeatures: { jsx: true } },
		},
	},
	{
		name: 'nexus/vue-parser',
		files: ['**/*.vue'],
		languageOptions: {
			parser: vueParser,
			parserOptions: { parser: typescriptParser, extraFileExtensions: ['.vue'] },
		},
	},
	{
		name: 'nexus/contract-declaration-spacing',
		files: ['packages/sdk/**/*.{ts,tsx}', 'plugins/*/src/shared/**/*.{ts,tsx}'],
		rules: { 'nexus-style/function-spacing': ['error', { topLevelDeclarations: true }] },
	},
];
