import { agentHttpClient as httpClient, agentRuntimeRequest } from './agent-http-client';
import type { AgentArtifactRef, AgentEnvelope, AgentSettingsView } from './agent-api.types';

const unwrap = <T>(envelope: AgentEnvelope<T>): T => envelope.data;

export interface WorkspaceRuntimeAvailability {
  available: boolean;
  state: 'unavailable' | 'uninitialized' | 'ready' | 'degraded';
  reason: string;
  deploymentId: string | null;
  controllerVersion: string | null;
  sandbox: { available: boolean; reason: string | null };
  capabilities: { egressAllowlist: boolean };
}

export interface WorkspaceResourceLimits {
  cpus: number;
  memoryBytes: number;
  pids: number;
  tmpfsBytes: number;
}

export interface WorkspaceNetworkPolicy {
  mode: 'none' | 'allowlist';
  hosts: string[];
}

export interface ToolchainPackRef {
  familyId: string;
  versionId: string;
  contentDigest: string;
}

export interface WorkspaceRecipe {
  id: string;
  revision: string;
  kind: 'shell' | 'code' | 'data' | 'browser';
  displayName: string;
  allowedFamilies: string[];
  requiredCapabilities: string[];
  defaultFamilies: string[];
  defaultLimits: WorkspaceResourceLimits;
  networkDefaults: WorkspaceNetworkPolicy;
}

export interface ToolchainCatalogPack extends ToolchainPackRef {
  schemaVersion: 1;
  displayName: string;
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
  sandboxOverheadBytes: number;
  reclaimableBytes: number;
  byPack: Array<{ familyId: string; versionId: string; bytes: number; inUse: boolean }>;
  byWorkspace: Array<{ workspaceId: string; runtimeBytes: number; status: string }>;
  filesystem: { totalBytes: number; freeBytes: number };
}

export interface WorkspaceRuntimeCommandView {
  id: string;
  userId: number;
  appId: string;
  workspaceId: string | null;
  action: string;
  operationHash: string;
  generation: number;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown';
  result: unknown;
  deadlineAt: number;
  createdAt: number;
  completedAt: number | null;
}

export interface PluginRunnerTargetView {
  pluginId: string;
  version: string;
  sdkVersion: string;
  protocolVersion: 2;
  packageHash: string;
  entry: string;
}

export interface WorkspaceProfileView {
  kind: 'shell' | 'code' | 'data' | 'browser';
  recipeId: string;
  recipeRevision: string;
  runtimeDigest: string;
  catalogRevision: string;
  toolchain: ToolchainPackRef[];
  runnerPlugins: PluginRunnerTargetView[];
  limits: WorkspaceResourceLimits;
  network: WorkspaceNetworkPolicy;
}

export interface AgentWorkspaceView {
  id: string;
  userId: number;
  appId: string;
  runId: string;
  agentRuntimeId: string;
  retained: boolean;
  profile: WorkspaceProfileView;
  generation: number;
  status: 'creating' | 'ready' | 'starting' | 'running' | 'stopping' | 'stopped' | 'deleting' | 'deleted' | 'failed';
  retainedManifestRef: string | null;
  version: number;
  lastActiveAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceToolchainSwitchView {
  outcome: 'succeeded' | 'failed' | 'unknown';
  workspace: AgentWorkspaceView;
  commands: WorkspaceRuntimeCommandView[];
}

export type PluginWorkspacePermission = 'read' | 'write' | 'list' | 'delete';

export interface PluginWorkspaceGrant {
  targetPluginId: string;
  principalPluginId: string;
  path: string;
  permissions: PluginWorkspacePermission[];
}

export interface PluginWorkspaceGrantSet {
  revision: number;
  grants: PluginWorkspaceGrant[];
}

export interface WorkspaceArtifactImportResult {
  artifact: AgentArtifactRef;
  workspaceId: string;
  targetPluginId: string;
  path: string;
  writtenBytes: number;
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
  current: unknown;
  proposed: unknown;
  expiresAt: number;
}

export const createWorkspaceRuntimeApi = (mutationHeaders: () => Promise<Record<string, string>>) => ({
  async workspaceRuntimeAvailability(): Promise<WorkspaceRuntimeAvailability> {
    return unwrap(
      (await httpClient.get<AgentEnvelope<WorkspaceRuntimeAvailability>>('/agent/workspace-runtime/availability')).data,
    );
  },
  async workspaceRuntimeCatalog(): Promise<WorkspaceRuntimeCatalog> {
    return unwrap(
      (await httpClient.get<AgentEnvelope<WorkspaceRuntimeCatalog>>('/agent/workspace-runtime/catalog')).data,
    );
  },
  async workspaceRuntimeStorage(): Promise<WorkspaceRuntimeStorageView> {
    return unwrap(
      (await httpClient.get<AgentEnvelope<WorkspaceRuntimeStorageView>>('/agent/workspace-runtime/storage')).data,
    );
  },
  async previewWorkspaceRuntimeSetup(
    recipes: Array<{ recipeId: string; versions?: Record<string, string> }>,
    expectedVersion: number,
  ): Promise<WorkspaceRuntimeSetupPreview> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<WorkspaceRuntimeSetupPreview>>(
          '/agent/workspace-runtime/setup/preview',
          { recipes, expectedVersion },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async confirmWorkspaceRuntimeSetup(
    confirmationId: string,
    expectedVersion: number,
  ): Promise<WorkspaceRuntimeCommandView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<WorkspaceRuntimeCommandView>>(
          '/agent/workspace-runtime/setup/confirm',
          { confirmationId, expectedVersion },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async installToolchainPack(familyId: string, versionId: string): Promise<WorkspaceRuntimeCommandView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<WorkspaceRuntimeCommandView>>(
          `/agent/workspace-runtime/tool-packs/${encodeURIComponent(familyId)}/${encodeURIComponent(versionId)}/install`,
          {},
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async previewToolchainPackUninstall(
    familyId: string,
    versionId: string,
    expectedVersion: number,
  ): Promise<ToolchainPackUninstallPreview> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<ToolchainPackUninstallPreview>>(
          `/agent/workspace-runtime/tool-packs/${encodeURIComponent(familyId)}/${encodeURIComponent(versionId)}/uninstall/preview`,
          { expectedVersion },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async confirmToolchainPackUninstall(
    familyId: string,
    versionId: string,
    confirmationId: string,
    expectedVersion: number,
  ): Promise<WorkspaceRuntimeCommandView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<WorkspaceRuntimeCommandView>>(
          `/agent/workspace-runtime/tool-packs/${encodeURIComponent(familyId)}/${encodeURIComponent(versionId)}/uninstall/confirm`,
          { confirmationId, expectedVersion },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async previewWorkspaceRuntimeCleanup(expectedVersion: number): Promise<WorkspaceRuntimeCleanupPreview> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<WorkspaceRuntimeCleanupPreview>>(
          '/agent/workspace-runtime/runtime-cleanup/preview',
          { expectedVersion },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async confirmWorkspaceRuntimeCleanup(
    confirmationId: string,
    expectedVersion: number,
  ): Promise<WorkspaceRuntimeCommandView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<WorkspaceRuntimeCommandView>>(
          '/agent/workspace-runtime/runtime-cleanup/confirm',
          { confirmationId, expectedVersion },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async cleanupWorkspaceRuntimeCache(): Promise<WorkspaceRuntimeCommandView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<WorkspaceRuntimeCommandView>>(
          '/agent/workspace-runtime/cache-cleanup',
          {},
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async previewWorkspaceRuntimeSettingsReset(expectedVersion: number): Promise<WorkspaceRuntimeSettingsResetPreview> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<WorkspaceRuntimeSettingsResetPreview>>(
          '/agent/workspace-runtime/settings/reset/preview',
          { expectedVersion },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async confirmWorkspaceRuntimeSettingsReset(
    confirmationId: string,
    expectedVersion: number,
  ): Promise<AgentSettingsView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentSettingsView>>(
          '/agent/workspace-runtime/settings/reset/confirm',
          { confirmationId, expectedVersion },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async workspaceRuntimeCommand(commandId: string): Promise<WorkspaceRuntimeCommandView> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<WorkspaceRuntimeCommandView>>(
          `/agent/workspace-runtime/commands/${encodeURIComponent(commandId)}`,
        )
      ).data,
    );
  },
  async workspaces(appId: string, runId: string, rootOnly = false): Promise<AgentWorkspaceView[]> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentWorkspaceView[]>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/workspaces`,
          { params: rootOnly ? { runtime: 'root' } : undefined },
        )
      ).data,
    );
  },
  async workspace(appId: string, workspaceId: string): Promise<AgentWorkspaceView> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentWorkspaceView>>(
          `/apps/${encodeURIComponent(appId)}/workspaces/${encodeURIComponent(workspaceId)}`,
        )
      ).data,
    );
  },
  async createWorkspace(
    appId: string,
    runId: string,
    workspace: {
      recipeId: string;
      versions?: Record<string, string>;
      runnerPluginIds?: string[];
      limits?: Partial<WorkspaceResourceLimits>;
      network?: WorkspaceNetworkPolicy;
    },
    retained = false,
    catalogRevision?: string,
  ): Promise<AgentWorkspaceView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentWorkspaceView>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/workspaces`,
          agentRuntimeRequest({ workspace, retained, ...(catalogRevision ? { catalogRevision } : {}) }),
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async workspaceAction(
    appId: string,
    workspace: AgentWorkspaceView,
    action: 'start' | 'stop' | 'restart' | 'delete',
  ): Promise<WorkspaceRuntimeCommandView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<WorkspaceRuntimeCommandView>>(
          `/apps/${encodeURIComponent(appId)}/workspaces/${encodeURIComponent(workspace.id)}/actions`,
          agentRuntimeRequest({ action, expectedVersion: workspace.version, parameters: {} }),
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async switchWorkspaceToolVersions(
    appId: string,
    workspace: AgentWorkspaceView,
    versions: Record<string, string>,
    catalogRevision: string,
  ): Promise<WorkspaceToolchainSwitchView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<WorkspaceToolchainSwitchView>>(
          `/apps/${encodeURIComponent(appId)}/workspaces/${encodeURIComponent(workspace.id)}/tool-versions`,
          agentRuntimeRequest({ versions, expectedVersion: workspace.version, catalogRevision }),
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async workspaceGrants(
    appId: string,
    workspaceId: string,
    targetPluginId: string,
    signal?: AbortSignal,
  ): Promise<PluginWorkspaceGrantSet> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<PluginWorkspaceGrantSet>>(
          `/agent/apps/${encodeURIComponent(appId)}/workspaces/${encodeURIComponent(workspaceId)}/plugins/${encodeURIComponent(targetPluginId)}/grants`,
          { signal },
        )
      ).data,
    );
  },
  async replaceWorkspaceGrants(
    appId: string,
    workspaceId: string,
    targetPluginId: string,
    grants: Array<Pick<PluginWorkspaceGrant, 'principalPluginId' | 'path' | 'permissions'>>,
    expectedRevision: number,
  ): Promise<PluginWorkspaceGrantSet> {
    return unwrap(
      (
        await httpClient.put<AgentEnvelope<PluginWorkspaceGrantSet>>(
          `/agent/apps/${encodeURIComponent(appId)}/workspaces/${encodeURIComponent(workspaceId)}/plugins/${encodeURIComponent(targetPluginId)}/grants`,
          { grants, expectedRevision },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async exportWorkspaceArtifact(
    appId: string,
    workspaceId: string,
    targetPluginId: string,
    input: { path: string; name: string; mediaType: string },
  ): Promise<AgentArtifactRef> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentArtifactRef>>(
          `/agent/apps/${encodeURIComponent(appId)}/workspaces/${encodeURIComponent(workspaceId)}/plugins/${encodeURIComponent(targetPluginId)}/artifacts/export`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async importArtifactToWorkspace(
    appId: string,
    workspaceId: string,
    targetPluginId: string,
    input: { artifactId: string; path: string },
  ): Promise<WorkspaceArtifactImportResult> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<WorkspaceArtifactImportResult>>(
          `/agent/apps/${encodeURIComponent(appId)}/workspaces/${encodeURIComponent(workspaceId)}/plugins/${encodeURIComponent(targetPluginId)}/artifacts/import`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
});
