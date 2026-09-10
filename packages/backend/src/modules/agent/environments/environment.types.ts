import type { PluginRunnerTarget } from '../host/plugin-runner-target.port';
import type { JsonValue, Scope } from '../agent.types';

export type EnvironmentKind = 'shell' | 'code' | 'data' | 'browser';
export type EnvironmentStatus =
  'creating' | 'ready' | 'starting' | 'running' | 'stopping' | 'stopped' | 'deleting' | 'deleted' | 'failed';

export interface EnvironmentPackRef {
  familyId: string;
  versionId: string;
  contentDigest: string;
}

export interface EnvironmentResourceLimits {
  cpus: number;
  memoryBytes: number;
  pids: number;
  tmpfsBytes: number;
}

export type EnvironmentWorkspacePermission = 'read' | 'write' | 'list' | 'delete';

export interface EnvironmentWorkspaceGrant {
  targetPluginId: string;
  principalPluginId: string;
  path: string;
  permissions: EnvironmentWorkspacePermission[];
}

export interface EnvironmentWorkspaceGrantInput {
  principalPluginId: string;
  path: string;
  permissions: EnvironmentWorkspacePermission[];
}

export interface EnvironmentNetworkPolicy {
  mode: 'none' | 'allowlist';
  hosts: string[];
}

export interface EnvironmentRecipe {
  id: string;
  revision: string;
  kind: EnvironmentKind;
  displayName: string;
  allowedFamilies: string[];
  requiredCapabilities: string[];
  defaultFamilies: string[];
  defaultLimits: EnvironmentResourceLimits;
  networkDefaults: EnvironmentNetworkPolicy;
}

export interface EnvironmentCatalogPack {
  schemaVersion: 1;
  familyId: string;
  versionId: string;
  displayName: string;
  contentDigest: string;
  capabilities: string[];
  runnerApiRange: string;
  diskBytes: number;
  dependencies: Array<{ familyId: string; versionId: string }>;
  supportedArchitectures: string[];
  status: 'supported' | 'deprecated' | 'unavailable';
  sideBySide: boolean;
  installed: boolean;
  enabled: boolean;
  inUse: boolean;
}

export interface EnvironmentAvailability {
  available: boolean;
  state: 'unavailable' | 'uninitialized' | 'ready' | 'degraded';
  reason: string;
  deploymentId: string | null;
  controllerVersion: string | null;
  sandbox: { available: boolean; reason: string | null };
  capabilities: { egressAllowlist: boolean };
}

export interface EnvironmentCatalog {
  revision: string;
  runtimeDigest: string;
  recipes: EnvironmentRecipe[];
  packs: EnvironmentCatalogPack[];
}

export interface EnvironmentStorageView {
  stateBytes: number;
  packBytes: number;
  cacheBytes: number;
  runtimeBytes: number;
  quarantineBytes: number;
  sandboxOverheadBytes: number;
  reclaimableBytes: number;
  byPack: Array<{ familyId: string; versionId: string; bytes: number; inUse: boolean }>;
  byEnvironment: Array<{ environmentId: string; runtimeBytes: number; status: string }>;
  filesystem: { totalBytes: number; freeBytes: number };
}

export interface EnvironmentGroupView extends Scope {
  id: string;
  runId: string;
  agentRuntimeId: string;
  status: EnvironmentStatus;
  retained: boolean;
  limits: JsonValue;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface EnvironmentView {
  id: string;
  groupId: string;
  kind: EnvironmentKind;
  recipeId: string;
  recipeRevision: string;
  runtimeDigest: string;
  catalogRevision: string;
  packRefs: EnvironmentPackRef[];
  runnerPlugins: PluginRunnerTarget[];
  generation: number;
  status: EnvironmentStatus;
  limits: EnvironmentResourceLimits;
  network: EnvironmentNetworkPolicy;
  retainedManifestRef: string | null;
  version: number;
  lastActiveAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface EnvironmentGroupDetail extends EnvironmentGroupView {
  environments: EnvironmentView[];
}

export interface EnvironmentCommandView extends Scope {
  id: string;
  environmentId: string | null;
  groupId: string | null;
  action: string;
  operationHash: string;
  generation: number;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown';
  result: JsonValue | null;
  deadlineAt: number;
  createdAt: number;
  completedAt: number | null;
}

export interface EnvironmentCreateSpec {
  recipeId: string;
  versions?: Record<string, string>;
  runnerPluginIds?: string[];
  limits?: Partial<EnvironmentResourceLimits>;
  network?: EnvironmentNetworkPolicy;
}
export interface EnvironmentSetupRecipeSelection {
  recipeId: string;
  versions?: Record<string, string>;
}

export interface EnvironmentSetupPreview {
  confirmationId: string;
  expectedVersion: number;
  catalogRevision: string;
  enabledRecipeIds: string[];
  packs: EnvironmentPackRef[];
  missingPacks: EnvironmentPackRef[];
  installBytes: number;
  expiresAt: number;
}

export interface EnvironmentPackUninstallPreview {
  confirmationId: string;
  expectedVersion: number;
  catalogRevision: string;
  pack: EnvironmentPackRef & { displayName: string; bytes: number };
  installed: boolean;
  inUse: boolean;
  wasEnabled: boolean;
  wasDefault: boolean;
  replacementDefaultVersionId: string | null;
  expiresAt: number;
}

export interface EnvironmentRuntimeCleanupPreview {
  confirmationId: string;
  expectedVersion: number;
  catalogRevision: string;
  environmentCount: number;
  activeCount: number;
  retainedCount: number;
  estimatedReclaimableBytes: number;
  environmentIds: string[];
  expiresAt: number;
}

export interface EnvironmentSettingsResetPreview {
  confirmationId: string;
  expectedVersion: number;
  catalogRevision: string;
  current: JsonValue;
  proposed: JsonValue;
  expiresAt: number;
}
