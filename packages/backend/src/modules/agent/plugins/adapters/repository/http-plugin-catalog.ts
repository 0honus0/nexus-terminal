import { AGENT_PLUGIN_VERSION_PATTERN } from '@nexus-terminal/shared/agent/plugins/values';
import { createHash } from 'node:crypto';
import type { BoundedFetch } from '../../../../../platform/network/bounded-fetch.js';
import { FetchFailure } from '../../../../../platform/network/bounded-fetch.js';
import type { PluginRepositoryCatalog, StoredPluginCatalog } from '../../storage/plugin-repository.js';
import { PluginRepositoryFailure } from '../../storage/plugin-repository.js';
import { AGENT_PLUGIN_MAX_ARCHIVE_BYTES } from '@nexus-terminal/shared/agent/plugins/values';

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
	if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) {
		throw new PluginRepositoryFailure('invalid_catalog');
	}
	return value;
}

function text(value: unknown, max: number): string {
	if (
		typeof value !== 'string' ||
		!value.trim() ||
		Buffer.byteLength(value) > max ||
		/[\u0000-\u001f\u007f]/u.test(value)
	) {
		throw new PluginRepositoryFailure('invalid_catalog');
	}
	return value;
}

function version(value: unknown): string {
	const result = text(value, 64);
	if (!AGENT_PLUGIN_VERSION_PATTERN.test(result)) {
		throw new PluginRepositoryFailure('invalid_catalog');
	}
	return result;
}

function publicKeyPem(value: unknown): string {
	if (
		typeof value !== 'string' ||
		!value.trim() ||
		Buffer.byteLength(value, 'utf8') > 8192 ||
		/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
	) {
		throw new PluginRepositoryFailure('invalid_catalog');
	}
	return value.replaceAll('\r\n', '\n');
}

function url(value: string): boolean {
	try {
		const parsed = new URL(value);
		return (
			Buffer.byteLength(value) <= 4096 &&
			['http:', 'https:'].includes(parsed.protocol) &&
			!parsed.username &&
			!parsed.password &&
			!parsed.hash
		);
	} catch {
		return false;
	}
}

export class HttpPluginCatalog implements PluginRepositoryCatalog {
	constructor(private readonly network: BoundedFetch) {}

	private async read(source: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
		try {
			const response = await this.network.get({
				url: source,
				headers: {
					Accept: 'application/json, application/octet-stream',
					'User-Agent': 'Nexus-Plugin-Repository/1',
				},
				maxBytes,
				signal,
				redirects: { max: 5, allow: url },
			});
			if (response.status !== 200) {
				throw new PluginRepositoryFailure('unavailable');
			}
			return response.bytes;
		} catch (cause) {
			if (cause instanceof PluginRepositoryFailure) {
				throw cause;
			}
			throw new PluginRepositoryFailure(cause instanceof FetchFailure ? cause.kind : 'unavailable', { cause });
		}
	}

	async catalog(source: string, signal: AbortSignal): Promise<StoredPluginCatalog> {
		const bytes = await this.read(source, 1024 * 1024, signal);
		try {
			const root = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), [
				'schemaVersion',
				'publishers',
				'packages',
			]);
			if (
				root.schemaVersion !== 1 ||
				!Array.isArray(root.publishers) ||
				root.publishers.length > 64 ||
				!Array.isArray(root.packages) ||
				root.packages.length > 512
			) {
				throw new PluginRepositoryFailure('invalid_catalog');
			}
			const publishers = root.publishers.map((raw) => {
				const row = record(raw, ['keyId', 'label', 'publicKeyPem']);
				const keyId = text(row.keyId, 128);
				if (!/^ed25519:[a-f0-9]{64}$/u.test(keyId)) {
					throw new PluginRepositoryFailure('invalid_catalog');
				}
				return { keyId, label: text(row.label, 256), publicKeyPem: publicKeyPem(row.publicKeyPem) };
			});
			const keys = new Set(publishers.map((item) => item.keyId));
			if (keys.size !== publishers.length) {
				throw new PluginRepositoryFailure('invalid_catalog');
			}
			const packages = root.packages.map((raw) => {
				const row = record(raw, [
					'appId',
					'version',
					'sdkVersion',
					'nexus',
					'displayName',
					'description',
					'packageUrl',
					'sha256',
					'sizeBytes',
					'publisherKeyId',
				]);
				const nexus = record(row.nexus, ['minVersion', 'maxVersion']);
				const appId = text(row.appId, 128),
					publisherKeyId = text(row.publisherKeyId, 128),
					sha256 = text(row.sha256, 64);
				const packageUrl = new URL(text(row.packageUrl, 4096), source).href;
				if (
					!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u.test(appId) ||
					!keys.has(publisherKeyId) ||
					!/^[a-f0-9]{64}$/u.test(sha256) ||
					!url(packageUrl) ||
					typeof row.sizeBytes !== 'number' ||
					!Number.isSafeInteger(row.sizeBytes) ||
					row.sizeBytes < 1 ||
					row.sizeBytes > AGENT_PLUGIN_MAX_ARCHIVE_BYTES
				) {
					throw new PluginRepositoryFailure('invalid_catalog');
				}
				return {
					appId,
					version: version(row.version),
					sdkVersion: text(row.sdkVersion, 64),
					nexus: { minVersion: version(nexus.minVersion), maxVersion: version(nexus.maxVersion) },
					displayName: text(row.displayName, 256),
					description: text(row.description, 2048),
					packageUrl,
					sha256,
					sizeBytes: row.sizeBytes,
					publisherKeyId,
				};
			});
			if (new Set(packages.map((item) => item.appId + '@' + item.version)).size !== packages.length) {
				throw new PluginRepositoryFailure('invalid_catalog');
			}
			return { repositoryUrl: source, publishers, packages };
		} catch (cause) {
			throw cause instanceof PluginRepositoryFailure
				? cause
				: new PluginRepositoryFailure('invalid_catalog', { cause });
		}
	}

	async download(source: string, sizeBytes: number, sha256: string, signal: AbortSignal): Promise<Uint8Array> {
		const bytes = await this.read(source, sizeBytes, signal);
		if (bytes.byteLength !== sizeBytes || createHash('sha256').update(bytes).digest('hex') !== sha256) {
			throw new PluginRepositoryFailure('invalid_catalog');
		}
		return bytes;
	}
}
