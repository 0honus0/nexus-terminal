import type { JsonValue, Scope } from '../agent.types';

export const PLUGIN_BACKEND_PROTOCOL_VERSION = 1 as const;
export const PLUGIN_APP_INTENT_ARTIFACT_CHUNK_BYTES = 128 * 1024;

export interface PluginBackendStorageRecord {
  key: string;
  value: JsonValue;
  version: number;
  updatedAt: number;
}

export interface PluginBackendAppIntentReceipt {
  id: string;
  userId: number;
  senderAppId: string;
  receiverAppId: string;
  intentId: string;
  schemaVersion: number;
  input: JsonValue;
  artifactIds: string[];
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export interface PluginBackendAppIntentArtifact {
  id: string;
  appId: string;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
}

export interface PluginBackendSdkV1 {
  storage: {
    get(key: string): Promise<PluginBackendStorageRecord | null>;
    put(key: string, value: JsonValue, expectedVersion: number | null): Promise<PluginBackendStorageRecord>;
    delete(key: string, expectedVersion: number): Promise<boolean>;
  };
  intents: {
    create(input: {
      receiverAppId: string;
      intentId: string;
      input: JsonValue;
      artifactRefs?: Array<{ appId: string; id: string }>;
      confirmed: true;
    }): Promise<PluginBackendAppIntentReceipt>;
    listReceived(limit?: number): Promise<PluginBackendAppIntentReceipt[]>;
    revoke(receiptId: string): Promise<void>;
    artifacts: {
      get(receiptId: string, artifactId: string): Promise<PluginBackendAppIntentArtifact>;
      readRange(receiptId: string, artifactId: string, start: number, endInclusive: number): Promise<Uint8Array>;
    };
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
