import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { localeMessages } from '../packages/frontend/build/locale-messages.ts';

const source = (path: string): string => fileURLToPath(new URL('../packages/' + path, import.meta.url));

const exclude = ['**/node_modules/**', '**/support/**', '**/fixtures/**', '**/*.native.test.mjs'];
const testFiles = '**/*.test.{ts,mjs}';
const layerFiles = '*.test.{ts,mjs}';
const artifactRoot = process.env.NEXUS_TEST_ARTIFACT_DIR;
const dockerModuleFile = 'frontend/runtimes/workspace/integration/observation-ssh.test.mjs';

export default defineConfig({
	root: import.meta.dirname,
	cacheDir: process.env.NEXUS_TEST_CACHE_DIR,
	plugins: [localeMessages(), vue()],
	resolve: {
		alias: [
			{ find: '@', replacement: source('frontend/src') },
			{ find: /^@nexus-terminal\/shared\/(.+)$/, replacement: source('shared/src/$1.ts') },
		],
		dedupe: ['vue', 'pinia', 'vue-router'],
	},
	test: {
		allowOnly: !process.env.CI,
		retry: 0,
		reporters: artifactRoot
			? ['default', ['json', { outputFile: artifactRoot + '/reports/vitest.json' }]]
			: ['default'],
		coverage: {
			provider: 'v8',
			include: ['../packages/{shared,backend,frontend}/src/**/*.{ts,vue}'],
			...(artifactRoot ? { reportsDirectory: artifactRoot + '/reports/coverage' } : {}),
		},
		projects: [
			{
				extends: true,
				test: { name: 'tooling', environment: 'node', include: ['tooling/' + testFiles], exclude },
			},
			{ extends: true, test: { name: 'shared', environment: 'node', include: ['shared/' + testFiles], exclude } },
			{
				extends: true,
				test: {
					name: 'backend-logic',
					environment: 'node',
					include: ['backend/**/logic/' + layerFiles],
					exclude,
				},
			},
			{
				extends: true,
				test: {
					name: 'backend-storage',
					environment: 'node',
					include: ['backend/**/storage/' + layerFiles],
					exclude,
				},
			},
			{
				extends: true,
				test: {
					name: 'backend-protocol',
					environment: 'node',
					expect: { poll: { timeout: 10_000 } },
					// Retain the real SSH/SFTP suite's operation budget after removing the browser runner.
					testTimeout: 120_000,
					hookTimeout: 120_000,
					include: ['backend/**/protocol/' + layerFiles],
					exclude,
				},
			},
			{
				extends: true,
				test: {
					name: 'backend-http',
					environment: 'node',
					include: ['backend/**/http/' + layerFiles],
					exclude,
				},
			},
			{
				extends: true,
				test: {
					name: 'frontend-logic',
					environment: 'node',
					include: ['frontend/**/logic/' + layerFiles],
					exclude,
					environmentOptions: { jsdom: { url: 'http://localhost/' } },
				},
			},
			{
				extends: true,
				test: {
					name: 'frontend-integration',
					environment: 'jsdom',
					// These real HTTP/SSH scenarios retain the browser suite's operation budget.
					// Vitest's 5s default interrupted their measured 6–7s runs before cleanup.
					testTimeout: 120_000,
					include: ['frontend/**/integration/' + layerFiles],
					exclude: [...exclude, dockerModuleFile],
					environmentOptions: { jsdom: { url: 'http://localhost/' } },
				},
			},
			{
				extends: true,
				test: {
					name: 'frontend-docker',
					environment: 'jsdom',
					testTimeout: 120_000,
					include: [dockerModuleFile],
					exclude,
					environmentOptions: { jsdom: { url: 'http://localhost/' } },
				},
			},

			{
				extends: true,
				test: {
					name: 'frontend-components',
					environment: 'jsdom',
					include: ['frontend/**/components/' + layerFiles],
					exclude,
					environmentOptions: { jsdom: { url: 'http://localhost/' } },
				},
			},
		],
	},
});
