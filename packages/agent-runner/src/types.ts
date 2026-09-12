import { PLUGIN_RUNNER_PROTOCOL_VERSION } from './plugin-sdk.types';

export type WorkspaceKind = 'shell' | 'code' | 'data' | 'browser';
export type WorkspaceStatus = 'creating' | 'ready' | 'running' | 'stopped' | 'deleted' | 'failed';

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
}

export interface WorkspaceRecipe {
  id: string;
  revision: string;
  kind: WorkspaceKind;
  displayName: string;
  allowedFamilies: string[];
  defaultFamilies: string[];
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

interface WorkspaceCommandBase {
  commandId: string;
  workspaceId: string;
  generation: number;
  deadlineAt: number;
}

export interface WorkspaceProvisionCommand extends WorkspaceCommandBase {
  action: 'provision';
  recipeId: string;
  recipeRevision: string;
  runtimeDigest: string;
  catalogRevision: string;
  toolchain: ToolchainPackRef[];
  runnerPlugins: PluginRunnerTarget[];
  acpProfiles: WorkspaceAcpProfile[];
  browserTarget: WorkspaceBrowserTarget | null;
  retained: boolean;
}

export interface WorkspaceLifecycleCommand extends WorkspaceCommandBase {
  action: 'start' | 'stop' | 'restart' | 'delete';
}

export type WorkspaceRuntimeCommand = WorkspaceProvisionCommand | WorkspaceLifecycleCommand;

export interface WorkspaceRecord {
  workspaceId: string;
  generation: number;
  status: WorkspaceStatus;
  retained: boolean;
  toolchain: ToolchainPackRef[];
  runnerPlugins: PluginRunnerTarget[];
  acpProfiles: WorkspaceAcpProfile[];
  browserTarget: WorkspaceBrowserTarget | null;
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

export interface WorkspaceJobInput {
  jobId: string;
  generation: number;
  deadlineAt: number;
  argv: string[];
  cwd: string;
  maxBytes: number;
  timeoutMs: number;
}

export interface WorkspaceJobRequest extends WorkspaceJobInput {
  workspaceId: string;
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
