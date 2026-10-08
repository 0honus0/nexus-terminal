import type { AgentArtifactRefDto } from './agent-artifacts.js';
import type { AgentJsonValueDto, AgentVersionedRequestDto } from './agent-common.js';
import type { AgentRunEnvironmentSelectionDto, AgentRunEnvironmentSnapshotDto } from './agent-runs.js';

export interface AgentToolchainPackRefDto {
  familyId: string;
  versionId: string;
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
  stagingPackBytes: number;
  cacheBytes: number;
  runtimeBytes: number;
  quarantineBytes: number;
  reclaimableBytes: number;
  byPack: Array<{ familyId: string; versionId: string; bytes: number; inUse: boolean }>;
  byWorkspace: Array<{ workspaceId: string; runtimeBytes: number; status: string }>;
  filesystem: { totalBytes: number; freeBytes: number };
}
