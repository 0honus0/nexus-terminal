import type { Scope } from '../agent.types';
import type { AppStorageSnapshot } from './app-storage-snapshot.port';
import type { PluginVersionRecord } from './plugin-install.repository.port';

export interface PluginBackendRuntimeHealth {
  available: boolean;
  reason: string | null;
}

export interface PluginBackendRuntimeReconcileTarget {
  scope: Scope;
  plugin: PluginVersionRecord;
  enabled: boolean;
}

export interface PluginBackendRuntimePort {
  reconcileUser(userId: number, targets: readonly PluginBackendRuntimeReconcileTarget[]): Promise<void>;
  health(scope: Scope, plugin: PluginVersionRecord): Promise<PluginBackendRuntimeHealth>;
  activate(scope: Scope, plugin: PluginVersionRecord): Promise<void>;
  quiesce(scope: Scope, plugin: PluginVersionRecord, deadlineUnixSeconds: number): Promise<void>;
  dispose(scope: Scope, plugin: PluginVersionRecord): Promise<void>;
  migrate(
    scope: Scope,
    fromVersion: string | null,
    plugin: PluginVersionRecord,
    storage: AppStorageSnapshot,
  ): Promise<AppStorageSnapshot>;
}
