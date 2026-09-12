import type { AgentAppManifest, AppRecord } from './app.types';

export type PluginStageStatus = 'staged' | 'verified' | 'failed' | 'installed';
export type PluginVersionStatus = 'verified' | 'installed' | 'failed' | 'removed';

export interface TrustedPublisherKey {
  userId: number;
  keyId: string;
  publicKeyPem: string;
  label: string;
  createdAt: number;
  revokedAt: number | null;
}

export type PluginStageSource =
  | { kind: 'artifact'; appId: string; id: string }
  | { kind: 'remote'; repositoryUrl: string; appId: string; version: string };

export interface PluginStageRecord {
  id: string;
  userId: number;
  source: PluginStageSource;
  packageHash: string;
  sizeBytes: number;
  publisherKeyId: string | null;
  appId: string | null;
  version: string | null;
  manifest: AgentAppManifest | null;
  status: PluginStageStatus;
  errorCode: string | null;
  createdAt: number;
  updatedAt: number;
  versionNumber: number;
}

export interface PluginInstallationRecord {
  userId: number;
  appId: string;
  version: string;
  status: 'installed' | 'removed';
  createdAt: number;
  updatedAt: number;
}

export interface PluginVersionRecord {
  appId: string;
  version: string;
  packageHash: string;
  publisherKeyId: string;
  manifest: AgentAppManifest;
  frontendEntry: string | null;
  backendEntry: string | null;
  runnerEntry: string | null;
  skillFiles: string[];
  status: PluginVersionStatus;
  installedAt: number | null;
  updatedAt: number;
}

export interface PluginInstallRepositoryPort {
  listPublisherKeys(userId: number): Promise<TrustedPublisherKey[]>;
  getPublisherKey(userId: number, keyId: string): Promise<TrustedPublisherKey | null>;
  putPublisherKey(record: TrustedPublisherKey): Promise<void>;
  revokePublisherKey(userId: number, keyId: string, revokedAt: number): Promise<boolean>;
  createStage(record: PluginStageRecord): Promise<void>;
  getStage(userId: number, stageId: string): Promise<PluginStageRecord | null>;
  listStages(): Promise<PluginStageRecord[]>;
  updateStage(
    userId: number,
    stageId: string,
    expectedVersion: number,
    patch: Partial<
      Pick<
        PluginStageRecord,
        'publisherKeyId' | 'appId' | 'version' | 'manifest' | 'status' | 'errorCode' | 'updatedAt'
      >
    >,
  ): Promise<PluginStageRecord>;
  upsertVersion(record: PluginVersionRecord): Promise<void>;
  getVersion(appId: string, version: string): Promise<PluginVersionRecord | null>;
  listVersions(appId?: string): Promise<PluginVersionRecord[]>;
  listVersionsForUser(userId: number, appId?: string): Promise<PluginVersionRecord[]>;
  updateVersionStatus(
    appId: string,
    version: string,
    status: PluginVersionStatus,
    installedAt: number | null,
    updatedAt: number,
  ): Promise<void>;
  getInstallation(userId: number, appId: string): Promise<PluginInstallationRecord | null>;
  listInstallations(userId: number): Promise<PluginInstallationRecord[]>;
  listActiveInstallations(): Promise<PluginInstallationRecord[]>;
  upsertInstallation(record: PluginInstallationRecord): Promise<void>;
  activateInstallation(
    userId: number,
    appId: string,
    fromVersion: string,
    toVersion: string,
    expectedAppStateVersion: number,
    observedState: AppRecord['observedState'],
    updatedAt: number,
  ): Promise<AppRecord>;
  removeInstallation(
    userId: number,
    appId: string,
    version: string,
    expectedAppStateVersion: number,
    updatedAt: number,
  ): Promise<AppRecord>;
  countInstalled(appId: string, version: string): Promise<number>;
}
