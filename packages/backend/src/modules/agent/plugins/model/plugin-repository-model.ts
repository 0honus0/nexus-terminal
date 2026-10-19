import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import type {
	PluginRepositoryStorage,
	PluginRepositoryCatalog,
	StoredPluginRepositorySettings,
} from '../storage/plugin-repository.js';
import { PluginRepositoryFailure } from '../storage/plugin-repository.js';
import { PluginStorageRefusal } from '../storage/plugin-storage.js';
import { AgentFailure, ToolCleanupFailure } from '../../agent-failure.js';
import { agentStorage } from '../../agent-storage-failure.js';
import type { PluginActor, PluginRepositorySettings, PluginCatalog, PluginCatalogEntry } from './plugin-types.js';

function settings(value: StoredPluginRepositorySettings): PluginRepositorySettings {
	return {
		version: value.version,
		repositories: value.repositories.map((item) => ({ url: item.url })),
		updatedAt: value.updatedAt,
	};
}

async function storage<T>(work: () => Promise<T>): Promise<T> {
	return agentStorage(async () => {
		try {
			return await work();
		} catch (error) {
			if (error instanceof PluginStorageRefusal) {
				throw new AgentFailure(error.code, { cause: error });
			}
			throw error;
		}
	});
}

function repositoryFailure(error: unknown): never {
	if (error instanceof AgentFailure) {
		throw error;
	}
	if (error instanceof PluginRepositoryFailure) {
		if (error.kind === 'cleanup_failed') {
			throw new ToolCleanupFailure({ cause: error });
		}
		throw new AgentFailure(error.kind === 'limit_exceeded' ? 'limit_exceeded' : 'provider_unavailable', {
			cause: error,
		});
	}
	throw new AgentFailure('internal_failure', { cause: error });
}

export class PluginRepositoryModel {
	constructor(
		private readonly database: PluginRepositoryStorage,
		private readonly network: PluginRepositoryCatalog,
		private readonly tokens: SessionTokens,
	) {}

	async get(actor: PluginActor, admit: (identity: number | null) => void): Promise<PluginRepositorySettings> {
		return settings(await storage(() => this.database.get(actor.userId, this.tokens.digest(actor.token), admit)));
	}

	async put(
		actor: PluginActor,
		expectedVersion: number,
		repositories: { url: string }[],
		admit: (identity: number | null, current: PluginRepositorySettings) => void,
	): Promise<PluginRepositorySettings> {
		return settings(
			await storage(() =>
				this.database.put(
					actor.userId,
					this.tokens.digest(actor.token),
					expectedVersion,
					repositories.map((item) => ({ url: item.url })),
					Date.now(),
					(identity, current) => admit(identity, settings(current)),
				),
			),
		);
	}

	async catalog(
		url: string,
		signal: AbortSignal,
		compatible: (sdkVersion: string, minVersion: string, maxVersion: string) => boolean,
	): Promise<PluginCatalog> {
		try {
			const value = await this.network.catalog(url, signal);
			return {
				repositoryUrl: value.repositoryUrl,
				publishers: value.publishers.map((item) => ({
					keyId: item.keyId,
					label: item.label,
					publicKeyPem: item.publicKeyPem,
				})),
				packages: value.packages.map((item) => ({
					appId: item.appId,
					version: item.version,
					sdkVersion: item.sdkVersion,
					nexus: { minVersion: item.nexus.minVersion, maxVersion: item.nexus.maxVersion },
					displayName: item.displayName,
					description: item.description,
					packageUrl: item.packageUrl,
					sha256: item.sha256,
					sizeBytes: item.sizeBytes,
					publisherKeyId: item.publisherKeyId,
					compatible: compatible(item.sdkVersion, item.nexus.minVersion, item.nexus.maxVersion),
				})),
			};
		} catch (error) {
			repositoryFailure(error);
		}
	}

	async download(entry: PluginCatalogEntry, signal: AbortSignal): Promise<Uint8Array> {
		try {
			return await this.network.download(entry.packageUrl, entry.sizeBytes, entry.sha256, signal);
		} catch (error) {
			repositoryFailure(error);
		}
	}
}
