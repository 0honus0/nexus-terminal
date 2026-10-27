import type { PackageReader, PackageSignature } from '../../../../../platform/packages/package-reader.js';
import type { PluginPackageDecoder, DecodedPluginPackage } from '../../storage/plugin-package.js';
import { PluginPackageFailure } from '../../storage/plugin-package.js';
import { pluginManifest, pluginEntry } from './plugin-manifest.js';

function isRecord(input: unknown): input is Record<string, unknown> {
	return input !== null && typeof input === 'object' && !Array.isArray(input);
}

function json(bytes: Uint8Array, maxBytes: number): unknown {
	if (bytes.byteLength > maxBytes) {
		throw new PluginPackageFailure();
	}
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch (cause) {
		throw new PluginPackageFailure({ cause });
	}
}

export class NativePluginPackageDecoder implements PluginPackageDecoder {
	constructor(
		private readonly reader: PackageReader,
		private readonly signature: PackageSignature,
	) {}

	async decode(bytes: Uint8Array, resolveKey: (id: string) => string | null): Promise<DecodedPluginPackage> {
		try {
			const files = await this.reader.read(bytes, {
				maxEntries: 10000,
				maxExpandedBytes: 200 * 1024 * 1024,
				maxFileBytes: 50 * 1024 * 1024,
			});
			const filesByPath = new Map(files.map((file) => [file.path, file]));
			const manifestFile = filesByPath.get('manifest.json'),
				listFile = filesByPath.get('files.json'),
				signatureFile = filesByPath.get('signature.ed25519');
			if (!manifestFile || !listFile || !signatureFile) {
				throw new PluginPackageFailure();
			}
			const manifest = pluginManifest(json(manifestFile.bytes, 65536));
			const list = json(listFile.bytes, 1024 * 1024);
			if (
				!isRecord(list) ||
				Object.keys(list).length !== 3 ||
				list.schemaVersion !== 1 ||
				typeof list.publisherKeyId !== 'string' ||
				!/^ed25519:[a-f0-9]{64}$/u.test(list.publisherKeyId) ||
				!Array.isArray(list.files) ||
				list.files.length > 10000
			) {
				throw new PluginPackageFailure();
			}
			const listed = list.files.map((value) => {
				if (
					!isRecord(value) ||
					Object.keys(value).length !== 3 ||
					typeof value.path !== 'string' ||
					typeof value.sha256 !== 'string' ||
					!/^[a-f0-9]{64}$/u.test(value.sha256) ||
					typeof value.sizeBytes !== 'number' ||
					!Number.isSafeInteger(value.sizeBytes) ||
					value.sizeBytes < 0
				) {
					throw new PluginPackageFailure();
				}
				const path = pluginEntry(value.path);
				if (path === null || ['manifest.json', 'files.json', 'signature.ed25519'].includes(path)) {
					throw new PluginPackageFailure();
				}
				return { path, sizeBytes: value.sizeBytes, sha256: value.sha256 };
			});
			const listedPaths = new Set(listed.map((item) => item.path));
			if (listedPaths.size !== listed.length || listed.length !== files.length - 3) {
				throw new PluginPackageFailure();
			}
			for (const item of listed) {
				const file = filesByPath.get(item.path);
				if (!file || file.bytes.byteLength !== item.sizeBytes || file.sha256 !== item.sha256) {
					throw new PluginPackageFailure();
				}
			}
			for (const entry of [manifest.frontendEntry, manifest.backendEntry]) {
				if (entry !== null && !listedPaths.has(entry)) {
					throw new PluginPackageFailure();
				}
			}
			const publicKey = resolveKey(list.publisherKeyId);
			const signatureValid =
				publicKey !== null &&
				this.signature.normalize(publicKey).id === list.publisherKeyId &&
				this.signature.verify(
					publicKey,
					Buffer.from('NEXUS_AGENT_PLUGIN_V1\0', 'utf8'),
					[manifestFile.bytes, listFile.bytes],
					signatureFile.bytes,
				);
			return {
				manifest,
				publisherKeyId: list.publisherKeyId,
				signatureValid,
				files: listed.map((file) => {
					const source = filesByPath.get(file.path);
					if (!source) {
						throw new PluginPackageFailure();
					}
					return { path: file.path, sizeBytes: file.sizeBytes, sha256: file.sha256, bytes: source.bytes };
				}),
			};
		} catch (cause) {
			throw cause instanceof PluginPackageFailure ? cause : new PluginPackageFailure({ cause });
		}
	}
}
