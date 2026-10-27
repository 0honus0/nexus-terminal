import { fileURLToPath } from 'node:url';

export default {
	resolve: {
		alias: { '@': fileURLToPath(new URL('../../packages/frontend/src', import.meta.url)) },
	},
	build: {
		target: 'es2025',
		outDir: fileURLToPath(new URL('../../packages/frontend/dist/__e2e__', import.meta.url)),
		lib: {
			entry: fileURLToPath(new URL('./support/browser-clients.ts', import.meta.url)),
			formats: ['es'],

			fileName: () => 'browser-clients.js',
		},
	},
};
