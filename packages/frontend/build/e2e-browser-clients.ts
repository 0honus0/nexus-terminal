import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Invoked only by the E2E build; production builds never include these entries.
export default defineConfig({
	publicDir: false,
	resolve: {
		alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
	},
	plugins: [vue()],
	build: {
		target: 'es2025',
		outDir: fileURLToPath(new URL('../dist/__e2e__', import.meta.url)),
		lib: {
			entry: {
				'browser-clients': fileURLToPath(new URL('../../../tests/e2e/support/browser-clients.ts', import.meta.url)),
				'browser-terminal': fileURLToPath(new URL('./e2e-browser-terminal.ts', import.meta.url)),
			},
			formats: ['es'],
			cssFileName: 'browser-terminal',

			fileName: (_format, entryName) => entryName + '.js',
		},
	},
});
