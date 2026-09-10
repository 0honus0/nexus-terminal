import type { JsonValue, Scope } from '../agent.types';

export const PLUGIN_BACKEND_PROTOCOL_VERSION = 1 as const;

export interface PluginBackendStorageRecord {
  key: string;
  value: JsonValue;
  version: number;
  updatedAt: number;
}

export interface PluginBackendSdkV1 {
  storage: {
    get(key: string): Promise<PluginBackendStorageRecord | null>;
    put(key: string, value: JsonValue, expectedVersion: number | null): Promise<PluginBackendStorageRecord>;
    delete(key: string, expectedVersion: number): Promise<boolean>;
  };
}

export interface PluginBackendActivationContextV1 {
  schemaVersion: 1;
  protocolVersion: typeof PLUGIN_BACKEND_PROTOCOL_VERSION;
  scope: Readonly<Scope>;
  plugin: Readonly<{ pluginId: string; version: string; sdkVersion: string }>;
  sdk: PluginBackendSdkV1;
}

export interface PluginBackendModuleV1 {
  activate?(context: PluginBackendActivationContextV1): Promise<void> | void;
  health?(): Promise<unknown> | unknown;
  quiesce?(deadlineUnixSeconds: number): Promise<void> | void;
  dispose?(): Promise<void> | void;
  migrate?(context: { fromVersion: string | null; storage: unknown }): Promise<unknown> | unknown;
}
