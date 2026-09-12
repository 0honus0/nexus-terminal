import type { PluginPackageSource } from './plugin-package-source.port';

export interface RemotePluginRepositoryConfig {
  url: string;
  privateHostExceptions: string[];
}

export interface RemotePluginPublisher {
  keyId: string;
  label: string;
  publicKeyPem: string;
}

export interface RemotePluginPackageEntry {
  appId: string;
  version: string;
  displayName: string;
  description: string;
  packageUrl: string;
  sha256: string;
  sizeBytes: number;
  publisherKeyId: string;
}

export interface RemotePluginCatalog {
  schemaVersion: 1;
  repositoryUrl: string;
  publishers: RemotePluginPublisher[];
  packages: RemotePluginPackageEntry[];
}

export interface RemotePluginRepositoryPort {
  catalog(config: RemotePluginRepositoryConfig, signal?: AbortSignal): Promise<RemotePluginCatalog>;
  openPackage(
    config: RemotePluginRepositoryConfig,
    entry: RemotePluginPackageEntry,
    signal?: AbortSignal,
  ): Promise<PluginPackageSource>;
}
