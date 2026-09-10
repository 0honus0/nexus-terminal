export const PLUGIN_FRONTEND_PROTOCOL_VERSION = 1 as const;

export const PLUGIN_FRONTEND_RPC_METHODS = ['host.appInfo', 'storage.get', 'storage.put', 'storage.delete'] as const;

export type PluginFrontendRpcMethod = (typeof PLUGIN_FRONTEND_RPC_METHODS)[number];

export interface PluginFrontendAppInfo {
  appId: string;
  version: string;
  sdkVersion: string;
  protocolVersion: typeof PLUGIN_FRONTEND_PROTOCOL_VERSION;
  displayName: string;
  declaredCapabilities: string[];
}

export interface PluginFrontendStorageRecord {
  key: string;
  value: unknown;
  version: number;
  updatedAt: number;
}

export interface PluginFrontendSdkV1 {
  host: {
    appInfo(): Promise<PluginFrontendAppInfo>;
  };
  storage: {
    get(key: string): Promise<PluginFrontendStorageRecord | null>;
    put(key: string, value: unknown, expectedVersion: number | null): Promise<PluginFrontendStorageRecord>;
    delete(key: string, expectedVersion: number): Promise<boolean>;
  };
}
