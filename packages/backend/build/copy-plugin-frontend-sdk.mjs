import { copyFile, mkdir } from 'node:fs/promises';

// Backend packages the Frontend-built browser asset without compiling or importing its private source.
const destination = new URL('../dist/modules/agent/plugins/adapters/frontend/', import.meta.url);
await mkdir(destination, { recursive: true });
await copyFile(
	new URL('../../frontend/dist-plugin-sdk/frontend-v4.mjs', import.meta.url),
	new URL('frontend-v4.mjs', destination),
);
