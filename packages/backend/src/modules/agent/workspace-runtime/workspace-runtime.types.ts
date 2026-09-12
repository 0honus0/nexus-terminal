import type { PluginRunnerTarget } from '../host/plugin-runner-target.port';
import type { JsonValue, Scope } from '../agent.types';

export type WorkspaceKind = 'shell' | 'code' | 'data' | 'browser';
export type WorkspaceStatus =
  'creating' | 'ready' | 'starting' | 'running' | 'stopping' | 'stopped' | 'deleting' | 'deleted' | 'failed';

export interface ToolchainPackRef {
  familyId: string;
  versionId: string;
  contentDigest: string;
}

export interface WorkspaceAcpProfile {
  id: string;
  profileRevision: number;
  argv: string[];
  cwd: string;
}

export interface WorkspaceBrowserEndpoint {
  scope: 'docker-network' | 'external-network';
  via: 'backend' | 'runner';
  url: string;
  priority: number;
  allowPlaintext: boolean;
  verifyTls: boolean;
}

export interface WorkspaceBrowserTarget {
  id: string;
  profileRevision: number;
  endpoints: WorkspaceBrowserEndpoint[];
  allowedUrlPatterns: string[];
}

export interface WorkspaceRecipe {
  id: string;
  revision: string;
  kind: WorkspaceKind;
  displayName: string;
  allowedFamilies: string[];
  defaultFamilies: string[];
}

export interface ToolchainCatalogPack {
  familyId: string;
  versionId: string;
  displayName: string;
  contentDigest: string;
  diskBytes: number;
  status: 'supported' | 'deprecated' | 'unavailable';
  installed: boolean;
  enabled: boolean;
  inUse: boolean;
}

export interface WorkspaceRuntimeAvailability {
  available: boolean;
  reason: string | null;
  mode: 'native';
  isolation: 'logical';
}

export interface WorkspaceRuntimeCatalog {
  revision: string;
  runtimeDigest: string;
  recipes: WorkspaceRecipe[];
  packs: ToolchainCatalogPack[];
}

export interface WorkspaceRuntimeStorageView {
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

/** Immutable input used to construct one Workspace generation. */
export interface WorkspaceProfileView {
  kind: WorkspaceKind;
  recipeId: string;
  recipeRevision: string;
  runtimeDigest: string;
  catalogRevision: string;
  toolchain: ToolchainPackRef[];
  runnerPlugins: PluginRunnerTarget[];
  acpProfiles: WorkspaceAcpProfile[];
  browserTarget: WorkspaceBrowserTarget | null;
}

/** Stable Agent Workspace identity; generation changes when the runtime profile changes. */
export interface AgentWorkspaceView extends Scope {
  id: string;
  runId: string;
  agentRuntimeId: string;
  retained: boolean;
  profile: WorkspaceProfileView;
  generation: number;
  status: WorkspaceStatus;
  retainedManifestRef: string | null;
  version: number;
  lastActiveAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceRuntimeCommandView extends Scope {
  id: string;
  workspaceId: string | null;
  action: string;
  operationHash: string;
  generation: number;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown';
  result: JsonValue | null;
  deadlineAt: number;
  createdAt: number;
  completedAt: number | null;
}

export interface WorkspaceToolchainSwitchView {
  outcome: 'succeeded' | 'failed' | 'unknown';
  workspace: AgentWorkspaceView;
  commands: WorkspaceRuntimeCommandView[];
}

export interface AgentWorkspaceCreateSpec {
  recipeId: string;
  versions?: Record<string, string>;
  runnerPluginIds?: string[];
  acpProfileIds?: string[];
  browserTargetId?: string;
}

export interface WorkspaceRuntimeSetupRecipeSelection {
  recipeId: string;
  versions?: Record<string, string>;
}

export interface WorkspaceRuntimeSetupPreview {
  confirmationId: string;
  expectedVersion: number;
  catalogRevision: string;
  enabledRecipeIds: string[];
  packs: ToolchainPackRef[];
  missingPacks: ToolchainPackRef[];
  installBytes: number;
  expiresAt: number;
}

export interface ToolchainPackUninstallPreview {
  confirmationId: string;
  expectedVersion: number;
  catalogRevision: string;
  pack: ToolchainPackRef & { displayName: string; bytes: number };
  installed: boolean;
  inUse: boolean;
  wasEnabled: boolean;
  wasDefault: boolean;
  replacementDefaultVersionId: string | null;
  expiresAt: number;
}

export interface WorkspaceRuntimeCleanupPreview {
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

export interface WorkspaceRuntimeSettingsResetPreview {
  confirmationId: string;
  expectedVersion: number;
  catalogRevision: string;
  current: JsonValue;
  proposed: JsonValue;
  expiresAt: number;
}
