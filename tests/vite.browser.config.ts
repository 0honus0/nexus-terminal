import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import host from '../vite.config.js';

const config = mergeConfig(host, {
	resolve: {
		alias: [
			{
				find: /^nexus-terminal\/browser$/u,
				replacement: fileURLToPath(new URL('../src/sdk/browser/index.ts', import.meta.url)),
			},
			{
				find: /^nexus-terminal\/browser\/ui$/u,
				replacement: fileURLToPath(new URL('../src/sdk/browser/ui-api.ts', import.meta.url)),
			},
		],
	},
});

// Mocked browser fixtures must never forward unhandled requests to the running development backend.
export default { ...config, server: { ...config.server, proxy: {} } };
