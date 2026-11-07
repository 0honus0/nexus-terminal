import { readAgentPluginCatalogIndex } from '@nexus-terminal/shared/agent/plugins/repository-http-codec';
import { createHash } from 'node:crypto';
import type { BoundedFetch } from '../../../../../platform/network/bounded-fetch.js';
import { FetchFailure } from '../../../../../platform/network/bounded-fetch.js';
import type { PluginRepositoryCatalog, StoredPluginCatalog } from '../../storage/plugin-repository.js';
import { PluginRepositoryFailure } from '../../storage/plugin-repository.js';

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
			const index = readAgentPluginCatalogIndex(
				JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
				source,
			);
			return {
				repositoryUrl: source,
				publishers: index.publishers.map((publisher) => ({
					keyId: publisher.keyId,
					label: publisher.label,
					publicKeyPem: publisher.publicKeyPem,
				})),
				packages: index.packages.map((entry) => {
					const packageUrl = new URL(entry.packageUrl, source).href;
					if (!url(packageUrl)) {
						throw new PluginRepositoryFailure('invalid_catalog');
					}
					return {
						packageId: entry.packageId,
						version: entry.version,
						compatibility: {
							host: {
								minVersion: entry.compatibility.host.minVersion,
								maxVersion: entry.compatibility.host.maxVersion,
							},
							backendSdk: entry.compatibility.backendSdk,
							frontendSdk: entry.compatibility.frontendSdk,
						},
						contributionKinds: entry.contributionKinds.map((kind) => kind),
						displayName: entry.displayName,
						description: entry.description,
						packageUrl,
						sha256: entry.sha256,
						sizeBytes: entry.sizeBytes,
						publisherKeyId: entry.publisherKeyId,
					};
				}),
			};
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
