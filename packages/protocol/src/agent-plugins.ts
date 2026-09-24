import type { AgentJsonValueDto } from './agent-common.js';
import type { AgentApprovalModeDto, AgentCapabilityDto } from './agent-host.js';
import type { AgentModelCapabilityDto } from './agent-providers.js';

export interface AgentPluginPublisherKeyDto {
  userId: number;
  keyId: string;
  label: string;
  createdAt: number;
  revokedAt: number | null;
}

export interface AgentPluginTrustPublisherRequestDto {
  publicKeyPem: string;
  label: string;
}

export interface AgentPluginRevokePublisherResponseDto {
  revoked: true;
}

export interface AgentPluginInstallationDto {
  userId: number;
  appId: string;
  version: string;
  status: 'installed' | 'removed';
  retainedDataEntries: number;
  retainedDataBytes: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentPluginManifestDto {
  schemaVersion: 1;
  id: string;
  version: string;
  displayName: string;
  sdkVersion: string;
  nexus: { minVersion: string; maxVersion: string };
  capabilities: AgentCapabilityDto[];
  intents: Array<{ id: string; schemaVersion: number }>;
  agents?: Array<{
    id: string;
    version: string;
    displayName: string;
    description: string;
    requiredModelCapabilities: AgentModelCapabilityDto[];
  }>;
  agentSurface?: { defaultApprovalMode?: AgentApprovalModeDto };
  targets?: {
    frontend?: { entry: string };
    backend?: { entry: string };
    runner?: { entry: string };
  };
}

export interface AgentPluginVersionDto {
  appId: string;
  version: string;
  packageHash: string;
  publisherKeyId: string;
  manifest: AgentPluginManifestDto;
  frontendEntry: string | null;
  backendEntry: string | null;
  runnerEntry: string | null;
  skillFiles: string[];
  status: 'verified' | 'installed' | 'failed' | 'removed';
  installedAt: number | null;
  updatedAt: number;
}

export interface AgentPluginVersionsQueryDto {
  appId?: string;
}

export type AgentPluginStageSourceDto =
  | { kind: 'artifact'; appId: string; id: string }
  | { kind: 'remote'; repositoryUrl: string; appId: string; version: string };

export interface AgentPluginStageDto {
  id: string;
  userId: number;
  source: AgentPluginStageSourceDto;
  packageHash: string;
  sizeBytes: number;
  publisherKeyId: string | null;
  appId: string | null;
  version: string | null;
  manifest: AgentPluginManifestDto | null;
  status: 'staged' | 'verified' | 'failed' | 'installed';
  errorCode: string | null;
  createdAt: number;
  updatedAt: number;
  versionNumber: number;
}

export interface AgentRemotePluginPublisherDto {
  keyId: string;
  label: string;
  publicKeyPem: string;
}

export interface AgentRemotePluginPackageDto {
  appId: string;
  version: string;
  sdkVersion: string;
  nexus: { minVersion: string; maxVersion: string };
  compatible?: boolean;
  displayName: string;
  description: string;
  packageUrl: string;
  sha256: string;
  sizeBytes: number;
  publisherKeyId: string;
}

export interface AgentRemotePluginCatalogDto {
  schemaVersion: 1;
  repositoryUrl: string;
  publishers: AgentRemotePluginPublisherDto[];
  packages: AgentRemotePluginPackageDto[];
}

export interface AgentPluginOfficialStageRequestDto {
  appId: string;
  version: string;
}

export interface AgentPluginRemoteCatalogQueryDto {
  repositoryUrl: string;
}

export interface AgentPluginRemoteStageRequestDto {
  repositoryUrl: string;
  appId: string;
  version: string;
}

export interface AgentPluginArtifactStageRequestDto {
  artifactRef: { appId: string; id: string };
}

export interface AgentPluginStageIdRequestDto {
  stageId: string;
}

export interface AgentPluginVerifyResultDto {
  stage: AgentPluginStageDto;
  plugin: AgentPluginVersionDto;
}

export interface AgentPluginAppStateDto {
  userId: number;
  appId: string;
  activeVersion: string;
  desiredState: 'enabled' | 'disabled';
  observedState: 'disabled' | 'enabling' | 'running' | 'degraded' | 'failed' | 'disabling';
  healthReason: string | null;
  policyRevision: number;
  runningCount: number;
  approvalCount: number;
  budgetRequestCount: number;
  acceptNewRuns: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
  displayName: string;
  capabilities: AgentCapabilityDto[];
  surface: 'builtin' | 'agent' | 'custom' | 'none';
  defaultApprovalMode: AgentApprovalModeDto;
}

export interface AgentPluginInstallResultDto {
  stage: AgentPluginStageDto;
  plugin: AgentPluginVersionDto;
  app: AgentPluginAppStateDto;
}

export interface AgentPluginFrontendDescriptorDto {
  appId: string;
  version: string;
  sdkVersion: string;
  protocolVersion: 1;
  url: string;
  sandbox: 'allow-scripts';
  maxMessageBytes: 256000;
  requestTimeoutMs: 15000;
}

export type AgentPluginFrontendRpcMethodDto =
  | 'host.appInfo'
  | 'storage.get'
  | 'storage.put'
  | 'storage.delete'
  | 'intents.create'
  | 'intents.listReceived'
  | 'intents.revoke'
  | 'intents.artifacts.get';

export interface AgentPluginFrontendRpcRequestDto {
  version: string;
  method: AgentPluginFrontendRpcMethodDto;
  params: AgentJsonValueDto;
  operationId?: string;
}

export type AgentPluginFrontendRpcResponseDto = AgentJsonValueDto;

export interface AgentPluginUpgradeRequestDto {
  stageId: string;
  expectedVersion: number;
}

export interface AgentPluginUpgradeResultDto {
  state: 'draining' | 'completed';
  targetVersion: string;
  app: AgentPluginAppStateDto;
  plugin: AgentPluginVersionDto;
}

export interface AgentPluginUninstallRequestDto {
  deleteData: false;
  expectedVersion: number;
}

export interface AgentPluginUninstallResultDto {
  state: 'draining' | 'removed';
  app: AgentPluginAppStateDto;
}

export interface AgentPluginDeleteDataRequestDto {
  confirmed: true;
}

export interface AgentPluginDeleteDataResponseDto {
  deleted: true;
}

export interface AgentAppIntentArtifactRefDto {
  appId: string;
  id: string;
}

export interface AgentAppIntentCreateRequestDto {
  receiverAppId: string;
  intentId: string;
  input: AgentJsonValueDto;
  artifactRefs: AgentAppIntentArtifactRefDto[];
  confirmed: true;
}

export interface AgentAppIntentReceiptDto {
  id: string;
  userId: number;
  senderAppId: string;
  receiverAppId: string;
  intentId: string;
  schemaVersion: number;
  input: AgentJsonValueDto;
  artifactIds: string[];
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export interface AgentAppIntentListQueryDto {
  limit?: number;
}

export interface AgentAppIntentRevokeResponseDto {
  revoked: true;
}

export interface AgentAppIntentArtifactDto {
  id: string;
  appId: string;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
}
