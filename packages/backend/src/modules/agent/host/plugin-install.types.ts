import type { JsonValue } from '../agent.types';
import type {
  PluginInstallationRecord,
  PluginPendingUpgradeRecord,
  PluginStageRecord,
  PluginVersionRecord,
} from './plugin-install.repository.port';
import type { AppView } from './app.types';

export const PLUGIN_FRONTEND_PROTOCOL_VERSION = 1 as const;

export interface PluginStageInput {
  artifactAppId: string;
  artifactId: string;
}

export interface RemotePluginStageInput {
  repositoryUrl: string;
  appId: string;
  version: string;
}

export interface PluginInstallResult {
  stage: PluginStageRecord;
  plugin: PluginVersionRecord;
  app: AppView;
}

export interface PluginUpgradeResult {
  state: 'draining' | 'completed';
  targetVersion: string;
  app: AppView;
  plugin: PluginVersionRecord;
}
export interface PluginPendingUpgradeView extends PluginPendingUpgradeRecord {
  stage: PluginStageRecord;
  plugin: PluginVersionRecord;
  app: AppView;
}


export interface PluginUninstallResult {
  state: 'draining' | 'removed';
  app: AppView;
}

export interface PluginInstallationView extends PluginInstallationRecord {
  retainedDataEntries: number;
  retainedDataBytes: number;
}

export interface PluginFrontendDescriptor {
  appId: string;
  version: string;
  sdkVersion: string;
  protocolVersion: typeof PLUGIN_FRONTEND_PROTOCOL_VERSION;
  url: string;
  sandbox: 'allow-scripts';
  maxMessageBytes: 256_000;
  requestTimeoutMs: 15_000;
}

export interface PluginFrontendRpcRequest {
  version: string;
  method:
    | 'host.appInfo'
    | 'storage.get'
    | 'storage.put'
    | 'storage.delete'
    | 'intents.create'
    | 'intents.listReceived'
    | 'intents.revoke'
    | 'intents.artifacts.get';
  params: JsonValue;
  operationId?: string;
}

export interface PluginInstallHooks {
  versionInstalled(plugin: PluginVersionRecord): void;
  versionRemoved(appId: string, version: string): void;
}

export const NOOP_PLUGIN_INSTALL_HOOKS: PluginInstallHooks = {
  versionInstalled: () => undefined,
  versionRemoved: () => undefined,
};
