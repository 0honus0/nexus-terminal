import { readFile } from 'node:fs/promises';
import type { PluginSdkAssets } from '../../storage/plugin-sdk-assets.js';

/** Reads only the browser artifact built by Frontend and copied into the Backend distribution. */
export class BuiltPluginSdkAssets implements PluginSdkAssets {
	async read(path: string): Promise<Uint8Array | null> {
		if (path !== 'frontend-v4.mjs') {
			return null;
		}
		const bytes = await readFile(new URL('./frontend-v4.mjs', import.meta.url));
		if (bytes.byteLength > 1024 * 1024) {
			throw new Error('Plugin SDK module exceeds delivery budget');
		}
		return bytes;
	}
}
