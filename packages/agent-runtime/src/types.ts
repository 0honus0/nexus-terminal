import { PLUGIN_RUNNER_PROTOCOL_VERSION } from './plugin-sdk.types';

export type EnvironmentKind = 'shell' | 'code' | 'data' | 'browser';
export type EnvironmentStatus =
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

export interface PackRef {
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

export interface EnvironmentRecipe {
  id: string;
  revision: string;
  kind: EnvironmentKind;
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
  recipes: EnvironmentRecipe[];
  packs: CatalogPack[];
}

export interface EnvironmentCommand {
  commandId: string;
  deploymentId: string;
  userId: number;
  appId: string;
  runId: string;
  agentRuntimeId: string;
  groupId: string;
  environmentId: string;
  generation: number;
  action: 'provision' | 'start' | 'stop' | 'restart' | 'delete' | 'setNetwork' | 'resize';
  recipeId: string;
  recipeRevision: string;
  runtimeDigest: string;
  catalogRevision: string;
  packs: PackRef[];
  runnerPlugins?: PluginRunnerTarget[];
  limits: ResourceLimits;
  network: { mode: 'none' | 'allowlist'; hosts: string[] };
  retained: boolean;
  expectedVersion: number;
  operationHash: string;
  issuedAt: number;
  deadlineAt: number;
  nonce: string;
}

export interface EnvironmentRecord {
  environmentId: string;
  userId: number;
  appId: string;
  groupId: string;
  runId: string;
  agentRuntimeId: string;
  generation: number;
  status: EnvironmentStatus;
  sandboxId: string | null;
  commandId: string;
  retained: boolean;
  recipeId: string;
  recipeRevision: string;
  runtimeDigest: string;
  catalogRevision: string;
  packs: PackRef[];
  runnerPlugins?: PluginRunnerTarget[];
  limits: ResourceLimits;
  network: { mode: 'none' | 'allowlist'; hosts: string[] };
  updatedAt: number;
}

export interface CommandRecord {
  commandId: string;
  payloadHash: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown';
  action: string;
  environmentId: string | null;
  result: unknown | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface EnvironmentJobRequest {
  jobId: string;
  environmentId: string;
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

export interface EnvironmentJobResult {
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
  environmentId: string;
  generation: number;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';
  result: EnvironmentJobResult | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}
