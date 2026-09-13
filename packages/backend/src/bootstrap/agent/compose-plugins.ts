import { HttpRemotePluginRepositoryAdapter } from '../../infrastructure/agent/plugins/http-remote-plugin-repository.adapter';
import { ArtifactPluginPackageSourceAdapter } from '../../infrastructure/agent/plugins/artifact-plugin-package-source.adapter';
import { LocalPluginBackendRuntimeAdapter } from '../../infrastructure/agent/plugins/local-plugin-backend-runtime.adapter';
import { TarPackageVerifierAdapter } from '../../infrastructure/agent/plugins/tar-package-verifier.adapter';
import { SqlitePluginInstallRepository } from '../../infrastructure/agent/repositories/sqlite-plugin-install.repository';
import { SqliteAppStorageRepository } from '../../infrastructure/agent/repositories/sqlite-app-storage.repository';
import type { LocalArtifactStore } from '../../infrastructure/agent/artifacts/local-artifact-store';
import type { SqliteAppStateRepository } from '../../infrastructure/agent/repositories/sqlite-app-state.repository';
import type { RelationalDatabase } from '../../platform/storage/relational-database.port';
import type { ClockPort } from '../../modules/agent/agent.types';
import type { OutboundPolicyPort } from '../../modules/agent/ai/outbound-policy.port';
import type { AgentSettingsService } from '../../modules/agent/host/agent-settings.service';
import type { AppCapabilityBroker } from '../../modules/agent/host/app-capability-broker';
import type { AppRegistryService } from '../../modules/agent/host/app-registry.service';
import type { AppStoragePort } from '../../modules/agent/host/app-storage.port';
import { PluginInstallService } from '../../modules/agent/host/plugin-install.service';
import type { AgentDefinitionRegistry } from '../../modules/agent/runtime/definitions/agent-definition.registry';

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
  outboundPolicy: OutboundPolicyPort;
  settings: AgentSettingsService;
  definitions: AgentDefinitionRegistry;
  clock: ClockPort;
  onHostStateCommitted: (userId: number) => void;
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
  outboundPolicy,
  settings,
  definitions,
  clock,
  onHostStateCommitted,
}: ComposePluginsOptions): ComposedPlugins => {
  const appStorage = new SqliteAppStorageRepository(database);
  const pluginSdkStorage: AppStoragePort = {
    get: async (scope, key) => {
      const decision = await capabilityBroker.authorizeBackendStorage(scope);
      if (!decision.allowed) throw new Error(decision.code);
      return appStorage.get(scope, key);
    },
    put: async (scope, key, value, expectedVersion) => {
      const decision = await capabilityBroker.authorizeBackendStorage(scope);
      if (!decision.allowed) throw new Error(decision.code);
      return appStorage.put(scope, key, value, expectedVersion);
    },
    delete: async (scope, key, expectedVersion) => {
      const decision = await capabilityBroker.authorizeBackendStorage(scope);
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
    new HttpRemotePluginRepositoryAdapter(outboundPolicy),
    settings,
    registry,
    appStates,
    appStorage,
    capabilityBroker,
    pluginBackendRuntime,
    clock,
    nexusVersion,
    {
      versionInstalled: (plugin) =>
        definitions.replaceVersion(
          plugin.appId,
          plugin.version,
          (plugin.manifest.agents ?? []).map((definition) => ({
            ...definition,
            requiredModelCapabilities: [...definition.requiredModelCapabilities],
          })),
        ),
      versionRemoved: (appId, version) => definitions.removeVersion(appId, version),
    },
    onHostStateCommitted,
    publicOrigin,
    pluginFrontendOrigin,
  );

  return { appStorage, plugins };
};
