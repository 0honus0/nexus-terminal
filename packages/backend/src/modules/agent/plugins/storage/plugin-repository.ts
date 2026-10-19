export interface StoredPluginRepositorySettings {
	version: number;
	repositories: { url: string }[];
	updatedAt: number;
}

export interface StoredPluginCatalogEntry {
	appId: string;
	version: string;
	sdkVersion: string;
	nexus: { minVersion: string; maxVersion: string };
	displayName: string;
	description: string;
	packageUrl: string;
	sha256: string;
	sizeBytes: number;
	publisherKeyId: string;
}

export interface StoredPluginCatalog {
	repositoryUrl: string;
	publishers: { keyId: string; label: string; publicKeyPem: string }[];
	packages: StoredPluginCatalogEntry[];
}

export interface PluginRepositoryStorage {
	get(
		userId: number,
		digest: string,
		admit: (identity: number | null) => void,
	): Promise<StoredPluginRepositorySettings>;
	put(
		userId: number,
		digest: string,
		expectedVersion: number,
		repositories: { url: string }[],
		now: number,
		admit: (identity: number | null, current: StoredPluginRepositorySettings) => void,
	): Promise<StoredPluginRepositorySettings>;
}

export interface PluginRepositoryCatalog {
	catalog(url: string, signal: AbortSignal): Promise<StoredPluginCatalog>;
	download(url: string, sizeBytes: number, sha256: string, signal: AbortSignal): Promise<Uint8Array>;
}

export class PluginRepositoryFailure extends Error {
	constructor(
		readonly kind: 'invalid_catalog' | 'unavailable' | 'limit_exceeded' | 'cleanup_failed',
		options?: ErrorOptions,
	) {
		super(kind, options);
		this.name = 'PluginRepositoryFailure';
	}
}
