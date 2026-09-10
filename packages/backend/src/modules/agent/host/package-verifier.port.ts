import type { AgentAppManifest, ValidatedManifest } from './app.types';

export interface PluginStageSource {
  stageId: string;
  source: AsyncIterable<Uint8Array>;
  sizeBytes: number;
}

export interface StagedPluginPackage {
  stageId: string;
  packageHash: string;
  sizeBytes: number;
}

export interface VerifiedPluginFile {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface VerifiedPluginPackage {
  stageId: string;
  packageHash: string;
  publisherKeyId: string;
  manifest: ValidatedManifest;
  files: VerifiedPluginFile[];
  frontendEntry: string | null;
  backendEntry: string | null;
  runnerEntry: string | null;
  skillFiles: string[];
}

export interface PublisherKeyInfo {
  keyId: string;
  publicKeyPem: string;
}

export interface PackageVerifierPort {
  normalizePublisherKey(publicKeyPem: string): Promise<PublisherKeyInfo>;
  stage(source: PluginStageSource): Promise<StagedPluginPackage>;
  verify(
    stageId: string,
    resolvePublisherKey: (keyId: string) => Promise<string | null>,
    validateManifest: (raw: AgentAppManifest) => ValidatedManifest,
  ): Promise<VerifiedPluginPackage>;
  install(stageId: string, verified: VerifiedPluginPackage): Promise<void>;
  removeInstalled(appId: string, version: string): Promise<void>;
  discardStage(stageId: string): Promise<void>;
  reconcileStages(activeStageIds: readonly string[]): Promise<void>;
}
