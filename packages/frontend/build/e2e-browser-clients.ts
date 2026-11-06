import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { localeMessages } from './locale-messages';

// Invoked only by the E2E build; production builds never include these entries.
export default defineConfig({
	publicDir: false,
	// Vite library mode preserves NODE_ENV for consumers; this consumer is the browser itself.
	define: { 'process.env.NODE_ENV': JSON.stringify('production') },
	resolve: {
		alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
	},
	plugins: [
		vue(),
		localeMessages(),
		{
			name: 'rdpsnd-test-delivery',
			enforce: 'pre',

			resolveId(id, importer) {
				if (
					id === '@devolutions/iron-remote-desktop-rdp' &&
					importer?.endsWith('/adapters/rdp-audio-output.ts')
				)
					return fileURLToPath(new URL('./e2e-rdp-audio-extension.ts', import.meta.url));
			},
		},
	],
	build: {
		target: 'es2025',
		outDir: fileURLToPath(new URL('../dist/__e2e__', import.meta.url)),
		lib: {
			entry: {
				'browser-clients': fileURLToPath(
					new URL('../../../tests/e2e/support/browser-clients.ts', import.meta.url),
				),
				'browser-locale': fileURLToPath(new URL('./e2e-browser-locale.ts', import.meta.url)),
				'browser-diagnostics': fileURLToPath(new URL('./e2e-browser-diagnostics.ts', import.meta.url)),
				'browser-terminal': fileURLToPath(new URL('./e2e-browser-terminal.ts', import.meta.url)),
				'browser-rdp': fileURLToPath(new URL('./e2e-browser-rdp.ts', import.meta.url)),
			},
			formats: ['es'],
			cssFileName: 'browser-terminal',

			fileName: (_format, entryName) => entryName + '.js',
		},
	},
});
