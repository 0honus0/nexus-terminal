import { ArtifactPluginPackageSourceAdapter } from '../../infrastructure/agent/plugins/artifact-plugin-package-source.adapter';
import { LocalPluginBackendRuntimeAdapter } from '../../infrastructure/agent/plugins/local-plugin-backend-runtime.adapter';
import { TarPackageVerifierAdapter } from '../../infrastructure/agent/plugins/tar-package-verifier.adapter';
import { SqlitePluginInstallRepository } from '../../infrastructure/agent/repositories/sqlite-plugin-install.repository';
import { SqliteAppStorageRepository } from '../../infrastructure/agent/repositories/sqlite-app-storage.repository';
import type { LocalArtifactStore } from '../../infrastructure/agent/artifacts/local-artifact-store';
import type { SqliteAppStateRepository } from '../../infrastructure/agent/repositories/sqlite-app-state.repository';
import type { RelationalDatabase } from '../../platform/storage/relational-database.port';
import type { ClockPort } from '../../modules/agent/agent.types';
import type { AppCapabilityBroker } from '../../modules/agent/host/app-capability-broker';
import type { AppRegistryService } from '../../modules/agent/host/app-registry.service';
import type { AppStoragePort } from '../../modules/agent/host/app-storage.port';
import { PluginInstallService } from '../../modules/agent/host/plugin-install.service';

export interface ComposePluginsOptions {
  database: RelationalDatabase;
  dataDirectory: string;
  nexusVersion: string;
  publicOrigin?: string;
  pluginFrontendOrigin?: string;
  registry: AppRegistryService;
  appStates: SqliteAppStateRepository;
  capabilityBroker: AppCapabilityBroker;
  artifactStore: LocalArtifactStore;
  clock: ClockPort;
}

export interface ComposedPlugins {
  appStorage: SqliteAppStorageRepository;
  plugins: PluginInstallService;
}

export const composePlugins = ({
  database,
  dataDirectory,
  nexusVersion,
  publicOrigin,
  pluginFrontendOrigin,
  registry,
  appStates,
  capabilityBroker,
  artifactStore,
  clock,
}: ComposePluginsOptions): ComposedPlugins => {
  const appStorage = new SqliteAppStorageRepository(database);
  const pluginSdkStorage: AppStoragePort = {
    get: async (scope, key) => {
      const decision = await capabilityBroker.authorize(scope, 'storage.app');
      if (!decision.allowed) throw new Error(decision.code);
      return appStorage.get(scope, key);
    },
    put: async (scope, key, value, expectedVersion) => {
      const decision = await capabilityBroker.authorize(scope, 'storage.app');
      if (!decision.allowed) throw new Error(decision.code);
      return appStorage.put(scope, key, value, expectedVersion);
    },
    delete: async (scope, key, expectedVersion) => {
      const decision = await capabilityBroker.authorize(scope, 'storage.app');
      if (!decision.allowed) throw new Error(decision.code);
      return appStorage.delete(scope, key, expectedVersion);
    },
  };
  const pluginBackendRuntime = new LocalPluginBackendRuntimeAdapter(dataDirectory, pluginSdkStorage);
  const pluginRepository = new SqlitePluginInstallRepository(database);
  const plugins = new PluginInstallService(
    pluginRepository,
    new TarPackageVerifierAdapter(dataDirectory),
    new ArtifactPluginPackageSourceAdapter(artifactStore),
    registry,
    appStates,
    appStorage,
    capabilityBroker,
    pluginBackendRuntime,
    clock,
    nexusVersion,
    publicOrigin,
    pluginFrontendOrigin,
  );

  return { appStorage, plugins };
};
