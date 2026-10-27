import { promisify } from 'node:util';
import { constants, gzip } from 'node:zlib';
import type { Plugin } from 'vite';

const compress = promisify(gzip);

/** Compress immutable build output once; nginx still negotiates gzip and serves originals when needed. */
export function precompressedAssets(): Plugin {
	return {
		name: 'nexus-precompressed-assets',
		apply: 'build',
		enforce: 'post',
		generateBundle: {
			order: 'post',

			async handler(_options, bundle) {
				const files = Object.values(bundle).filter((file) =>
					/\.(?:html|js|mjs|css|json|svg|wasm)$/i.test(file.fileName),
				);
				let index = 0;

				const worker = async () => {
					while (index < files.length) {
						const file = files[index++];
						if (!file) {
							continue;
						}
						const source = file.type === 'chunk' ? file.code : file.source;
						const bytes = typeof source === 'string' ? Buffer.from(source, 'utf8') : Buffer.from(source);
						if (bytes.length < 1024) {
							continue;
						}
						const compressed = await compress(bytes, { level: constants.Z_BEST_COMPRESSION });
						if (compressed.length >= bytes.length) {
							continue;
						}
						this.emitFile({ type: 'asset', fileName: file.fileName + '.gz', source: compressed });
					}
				};

				await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
			},
		},
	};
}
