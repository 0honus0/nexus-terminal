import { readFile } from 'node:fs/promises';
import type { PluginSdkAssets } from '../../storage/plugin-sdk-assets.js';

const modules = new Set([
	'agent/plugins/frontend-rpc-codec.js',
	'agent/scope/http-codec.js',
	'agent/scope/workspace-http-codec.js',
	'agent/scope/values.js',
	'agent/runs/http-codec.js',
	'agent/runs/values.js',
	'agent/providers/values.js',
	'agent/collaboration/http-codec.js',
	'agent/collaboration/values.js',
	'agent/governance/http-codec.js',
	'agent/plugins/rpc-codec.js',
	'agent/plugins/intent-http-codec.js',
	'agent/plugins/intent-values.js',
	'agent/artifacts/http-codec.js',
	'agent/artifacts/values.js',
	'agent/plugins/http-codec.js',
	'agent/plugins/values.js',
	'agent/http-codec.js',
	'agent/values.js',
	'agent/governance/values.js',
]);

export class BuiltPluginSdkAssets implements PluginSdkAssets {
	private readonly base = new URL('../../', import.meta.resolve('@nexus-terminal/shared/agent/plugins/rpc-codec'));

	async read(path: string): Promise<Uint8Array | null> {
		if (path === 'frontend-v1.mjs') {
			let source = await readFile(new URL('./plugin-sdk-client.js', import.meta.url), 'utf8');
			for (const name of [
				'agent/http-codec',
				'agent/plugins/frontend-rpc-codec',
				'agent/plugins/values',
				'agent/runs/values',
			]) {
				source = source.replaceAll("'@nexus-terminal/shared/" + name + "'", "'./" + name + ".js'");
			}
			return Buffer.from(source);
		}
		if (!modules.has(path)) {
			return null;
		}
		const bytes = await readFile(new URL(path, this.base));
		if (bytes.byteLength > 1024 * 1024) {
			throw new Error('Plugin SDK module exceeds delivery budget');
		}
		return bytes;
	}
}
