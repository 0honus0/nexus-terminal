import { PLUGIN_RUNNER_PROTOCOL_VERSION } from './plugin-sdk.types';

export type WorkspaceKind = 'shell' | 'code' | 'data' | 'browser';
export type WorkspaceStatus =
  'creating' | 'ready' | 'starting' | 'running' | 'stopping' | 'stopped' | 'deleting' | 'deleted' | 'failed';

export interface ResourceLimits {
  memoryBytes: number;
  cpus: number;
  pids: number;
  tmpfsBytes: number;
}

export interface PluginRunnerTarget {
  pluginId: string;
  version: string;
  sdkVersion: string;
  protocolVersion: typeof PLUGIN_RUNNER_PROTOCOL_VERSION;
  packageHash: string;
  entry: string;
}

export interface ToolchainPackRef {
  familyId: string;
  versionId: string;
  contentDigest: string;
}

export interface CatalogPack {
  schemaVersion: 1;
  familyId: string;
  versionId: string;
  displayName: string;
  contentDigestByArch: Record<string, string>;
  downloadRefByArch: Record<string, string>;
  capabilities: string[];
  runnerApiRange: string;
  diskBytes: number;
  dependencies: Array<{ familyId: string; versionId: string }>;
  supportedArchitectures: string[];
  status: 'supported' | 'deprecated' | 'unavailable';
  sideBySide: boolean;
}

export interface WorkspaceRecipe {
  id: string;
  revision: string;
  kind: WorkspaceKind;
  displayName: string;
  allowedFamilies: string[];
  requiredCapabilities: string[];
  defaultFamilies: string[];
  defaultLimits: ResourceLimits;
  networkDefaults: { mode: 'none' | 'allowlist'; hosts: string[] };
}

export interface RuntimeCatalog {
  schemaVersion: 1;
  revision: string;
  runtimeDigest: string;
  recipes: WorkspaceRecipe[];
  packs: CatalogPack[];
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

export interface WorkspaceRuntimeCommand {
  commandId: string;
  deploymentId: string;
  userId: number;
  appId: string;
  runId: string;
  agentRuntimeId: string;
  workspaceId: string;
  generation: number;
  action: 'provision' | 'start' | 'stop' | 'restart' | 'delete' | 'setNetwork' | 'resize';
  recipeId: string;
  recipeRevision: string;
  runtimeDigest: string;
  catalogRevision: string;
  toolchain: ToolchainPackRef[];
  runnerPlugins?: PluginRunnerTarget[];
  limits: ResourceLimits;
  network: { mode: 'none' | 'allowlist'; hosts: string[] };
  acpProfiles: WorkspaceAcpProfile[];
  browserTarget: WorkspaceBrowserTarget | null;
  retained: boolean;
  expectedVersion: number;
  operationHash: string;
  issuedAt: number;
  deadlineAt: number;
  nonce: string;
}

export interface WorkspaceRecord {
  workspaceId: string;
  userId: number;
  appId: string;
  runId: string;
  agentRuntimeId: string;
  generation: number;
  status: WorkspaceStatus;
  sandboxId: string | null;
  commandId: string;
  retained: boolean;
  recipeId: string;
  recipeRevision: string;
  runtimeDigest: string;
  catalogRevision: string;
  toolchain: ToolchainPackRef[];
  runnerPlugins?: PluginRunnerTarget[];
  limits: ResourceLimits;
  network: { mode: 'none' | 'allowlist'; hosts: string[] };
  acpProfiles: WorkspaceAcpProfile[];
  browserTarget: WorkspaceBrowserTarget | null;
  updatedAt: number;
}

export interface CommandRecord {
  commandId: string;
  payloadHash: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown';
  action: string;
  workspaceId: string | null;
  result: unknown | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface WorkspaceJobRequest {
  jobId: string;
  workspaceId: string;
  generation: number;
  userId: number;
  appId: string;
  runId: string;
  agentRuntimeId: string;
  operationHash: string;
  issuedAt: number;
  deadlineAt: number;
  nonce: string;
  argv: string[];
  cwd: string;
  maxBytes: number;
  timeoutMs: number;
}

export interface WorkspaceJobResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}

export interface JobRecord {
  jobId: string;
  payloadHash: string;
  workspaceId: string;
  generation: number;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';
  result: WorkspaceJobResult | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}
