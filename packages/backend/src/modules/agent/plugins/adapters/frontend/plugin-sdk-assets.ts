import { readFile } from 'node:fs/promises';
import type { PluginSdkAssets } from '../../storage/plugin-sdk-assets.js';

/** Build resolves the complete browser dependency graph, including CommonJS packages. */
export class BuiltPluginSdkAssets implements PluginSdkAssets {
	async read(path: string): Promise<Uint8Array | null> {
		if (path !== 'frontend-v1.mjs') {
			return null;
		}
		const bytes = await readFile(new URL('./plugin-sdk-browser.mjs', import.meta.url));
		if (bytes.byteLength > 1024 * 1024) {
			throw new Error('Plugin SDK module exceeds delivery budget');
		}
		return bytes;
	}
}
