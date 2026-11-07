import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Plugins bundle this public asset into their release. No Host implementation is exported.
await build({
	entryPoints: [fileURLToPath(new URL('../src/modules/agent/plugins/sdk/index.ts', import.meta.url))],
	outfile: fileURLToPath(new URL('../dist-plugin-sdk/backend-v4.mjs', import.meta.url)),
	bundle: true,
	format: 'esm',
	platform: 'node',
	target: 'node26',
});
