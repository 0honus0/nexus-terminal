import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// The browser runtime belongs to Frontend; its complete dependency graph is one public asset.
await build({
	entryPoints: [fileURLToPath(new URL('../src/features/agent/plugins/sdk/index.ts', import.meta.url))],
	outfile: fileURLToPath(new URL('../dist-plugin-sdk/frontend-v4.mjs', import.meta.url)),
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
});
