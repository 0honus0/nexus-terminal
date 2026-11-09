import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import hostConfig from '../../playwright.config';
import type { PlaywrightTestConfig } from '@playwright/test';

/** Plugin-owned specs use the exact Host artifact's runner, fixtures and controlled peers. */
export async function createPluginBrowserConfig(pluginRoot: string): Promise<PlaywrightTestConfig> {
	const artifactRoot = process.env.NEXUS_TEST_ARTIFACT_DIR;
	if (!artifactRoot || !process.env.NEXUS_TEST_PLUGIN_SET)
		throw new Error('Browser interoperability requires an artifact directory and exact candidate set');
	const root = path.resolve(artifactRoot, 'browser');
	await mkdir(root, { recursive: true });
	const hostRoot = path.resolve(import.meta.dirname, '../../..');
	const tsconfig = path.join(root, 'tsconfig.json');
	await writeFile(
		tsconfig,
		JSON.stringify({
			extends: path.join(hostRoot, 'tests/tsconfig.json'),
			compilerOptions: {
				module: 'ESNext',
				moduleResolution: 'Bundler',
				resolveJsonModule: true,
				types: [
					path.join(hostRoot, 'tests/node_modules/@types/node'),
					path.join(hostRoot, 'tests/node_modules/vite/client'),
				],
				paths: {
					'@/*': [path.join(hostRoot, 'packages/frontend/src/*')],
					'@nexus-test/*': [path.join(hostRoot, 'tests/*')],
					'@nexus-shared/*': [path.join(hostRoot, 'packages/shared/src/*')],
				},
			},
			include: [
				path.join(pluginRoot, 'tests/e2e/**/*.ts'),
				path.join(hostRoot, 'packages/frontend/src/**/*.d.ts'),
			],
		}),
	);
	return {
		...hostConfig,
		// Cases reset their own Host/peer baseline. Native case-level sharding
		// avoids assigning a whole large spec to one runner; workers stays 1
		// because each runner owns one fixed-port browser environment.
		fullyParallel: true,
		testDir: path.join(pluginRoot, 'tests/e2e/specs'),
		tsconfig,
		outputDir: path.join(root, 'results'),
		reporter: [['line'], ['json', { outputFile: path.join(root, 'report.json') }]],
	};
}
