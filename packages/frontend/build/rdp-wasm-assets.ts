import type { Plugin } from 'vite';

/** Keep IronRDP's embedded binary out of JS parsing and give it an independent hashed cache key. */
export function rdpWasmAssets(): Plugin {
	return {
		name: 'nexus-rdp-wasm-assets',
		apply: 'build',
		enforce: 'pre',

		transform(source, id) {
			if (!id.replaceAll('\\', '/').endsWith('/iron-remote-desktop-rdp/iron-remote-desktop-rdp.js')) return;
			const embedded = /"data:application\/wasm;base64,([A-Za-z0-9+/=]+)"/.exec(source);
			if (!embedded?.[1]) this.error('IronRDP embedded WASM asset was not found');
			const binary = Buffer.from(embedded[1], 'base64');
			if (binary.subarray(0, 8).toString('hex') !== '0061736d01000000') {
				this.error('IronRDP embedded WASM header is invalid');
			}
			const reference = this.emitFile({ type: 'asset', name: 'ironrdp.wasm', source: binary });
			return {
				code: source.replace(embedded[0], `import.meta.ROLLUP_FILE_URL_${reference}`),
				map: null,
			};
		},
	};
}
