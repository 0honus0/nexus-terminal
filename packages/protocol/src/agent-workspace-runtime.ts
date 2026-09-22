import type { AgentArtifactRefDto } from './agent-artifacts.js';
import type { AgentJsonValueDto, AgentVersionedRequestDto } from './agent-common.js';
import type { AgentHardLimitsDto, AgentSettingsDocumentDto } from './agent-host.js';
import type { AgentRunEnvironmentSelectionDto, AgentRunEnvironmentSnapshotDto } from './agent-runs.js';

export interface AgentToolchainPackRefDto {
  familyId: string;
  versionId: string;
  contentDigest: string;
}

export interface AgentWorkspaceRecipeDto {
  id: string;
  revision: string;
  kind: 'shell' | 'code' | 'data' | 'browser';
  displayName: string;
  allowedFamilies: string[];
  defaultFamilies: string[];
}

export interface AgentToolchainCatalogPackDto extends AgentToolchainPackRefDto {
  displayName: string;
  diskBytes: number;
  status: 'supported' | 'deprecated' | 'unavailable';
  installed: boolean;
  enabled: boolean;
  inUse: boolean;
}

export interface AgentWorkspaceRuntimeAvailabilityDto {
  available: boolean;
  reason: string | null;
  mode: 'native';
  isolation: 'logical';
}

export interface AgentWorkspaceRuntimeCatalogDto {
  revision: string;
  runtimeDigest: string;
  recipes: AgentWorkspaceRecipeDto[];
  packs: AgentToolchainCatalogPackDto[];
}

export interface AgentWorkspaceRuntimeStorageDto {
  stateBytes: number;
  packBytes: number;
  cacheBytes: number;
  runtimeBytes: number;
  quarantineBytes: number;
  reclaimableBytes: number;
  byPack: Array<{ familyId: string; versionId: string; bytes: number; inUse: boolean }>;
  byWorkspace: Array<{ workspaceId: string; runtimeBytes: number; status: string }>;
  filesystem: { totalBytes: number; freeBytes: number };
}

export type AgentWorkspaceStatusDto =
  | 'creating'
  | 'ready'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'deleting'
  | 'deleted'
  | 'failed';

export interface AgentWorkspaceDto {
  id: string;
  userId: number;
  appId: string;
  runId: string;
  agentRuntimeId: string;
  retained: boolean;
  profile: AgentRunEnvironmentSnapshotDto;
  generation: number;
  status: AgentWorkspaceStatusDto;
  retainedManifestRef: string | null;
  version: number;
  lastActiveAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentWorkspaceRuntimeCommandDto {
  id: string;
  userId: number;
  appId: string;
  workspaceId: string | null;
  action: string;
  operationHash: string;
  generation: number;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown';
  result: AgentJsonValueDto | null;
  deadlineAt: number;
  createdAt: number;
  completedAt: number | null;
}

export interface AgentWorkspaceToolchainSwitchDto {
  outcome: 'succeeded' | 'failed' | 'unknown';
  workspace: AgentWorkspaceDto;
  commands: AgentWorkspaceRuntimeCommandDto[];
}

export interface AgentWorkspaceArtifactImportResultDto {
  artifact: AgentArtifactRefDto;
  workspaceId: string;
  targetPluginId: string;
  path: string;
  writtenBytes: number;
}

export interface AgentWorkspaceRuntimeSetupRecipeSelectionDto {
  recipeId: string;
  versions?: Record<string, string>;
}

export interface AgentWorkspaceRuntimeSetupPreviewRequestDto {
  recipes: AgentWorkspaceRuntimeSetupRecipeSelectionDto[];
  expectedVersion: number;
}

export interface AgentWorkspaceRuntimeSetupPreviewDto {
  confirmationId: string;
  expectedVersion: number;
  catalogRevision: string;
  enabledRecipeIds: string[];
  packs: AgentToolchainPackRefDto[];
  missingPacks: AgentToolchainPackRefDto[];
  installBytes: number;
  expiresAt: number;
}

export interface AgentToolchainPackUninstallPreviewDto {
  confirmationId: string;
  expectedVersion: number;
  catalogRevision: string;
  pack: AgentToolchainPackRefDto & { displayName: string; bytes: number };
  installed: boolean;
  inUse: boolean;
  wasEnabled: boolean;
  wasDefault: boolean;
  replacementDefaultVersionId: string | null;
  expiresAt: number;
}

export interface AgentWorkspaceRuntimeCleanupPreviewDto {
  confirmationId: string;
  expectedVersion: number;
  catalogRevision: string;
  workspaceCount: number;
  activeCount: number;
  retainedCount: number;
  estimatedReclaimableBytes: number;
  workspaceIds: string[];
  expiresAt: number;
}

export interface AgentWorkspaceRuntimeSettingsResetPreviewDto {
  confirmationId: string;
  expectedVersion: number;
  catalogRevision: string;
  current: AgentJsonValueDto;
  proposed: AgentJsonValueDto;
  expiresAt: number;
}

export interface AgentWorkspaceRuntimeSettingsResetResultDto {
  requestedSettings: AgentSettingsDocumentDto;
  effectiveSettings: AgentSettingsDocumentDto;
  hardLimits: AgentHardLimitsDto;
  revision: number;
}

export interface AgentWorkspaceRuntimeConfirmationRequestDto {
  confirmationId: string;
  expectedVersion: number;
}

export interface AgentWorkspaceRuntimeExpectedVersionRequestDto {
  expectedVersion: number;
}

export type AgentWorkspaceRuntimeEmptyRequestDto = Record<string, never>;

export type AgentWorkspaceEnvironmentSpecDto = Omit<AgentRunEnvironmentSelectionDto, 'catalogRevision'>;

export interface AgentWorkspaceCreateFieldsDto {
  workspace: AgentWorkspaceEnvironmentSpecDto;
  retained: boolean;
  catalogRevision?: string;
}

export type AgentWorkspaceCreateRequestDto = AgentVersionedRequestDto<AgentWorkspaceCreateFieldsDto>;

export interface AgentWorkspaceActionFieldsDto {
  action: 'start' | 'stop' | 'restart' | 'delete';
  expectedVersion: number;
}

export type AgentWorkspaceActionRequestDto = AgentVersionedRequestDto<AgentWorkspaceActionFieldsDto>;

export interface AgentWorkspaceToolVersionsFieldsDto {
  versions: Record<string, string>;
  expectedVersion: number;
  catalogRevision?: string;
}

export type AgentWorkspaceToolVersionsRequestDto = AgentVersionedRequestDto<AgentWorkspaceToolVersionsFieldsDto>;

export interface AgentWorkspaceArtifactExportRequestDto {
  path: string;
  name: string;
  mediaType: string;
}

export interface AgentWorkspaceArtifactImportRequestDto {
  artifactId: string;
  path: string;
}

export interface AgentWorkspaceListQueryDto {
  runtime?: 'root';
}
