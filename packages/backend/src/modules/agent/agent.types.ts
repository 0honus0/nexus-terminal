export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface Scope {
  userId: number;
  appId: string;
}

export type AgentWorkspaceKind = 'shell' | 'code' | 'data' | 'browser';

export interface AgentWorkspaceEnvironmentSpec {
  recipeId: string;
  versions?: Record<string, string>;
  runnerPluginIds?: string[];
  acpProfileIds?: string[];
  browserTargetId?: string;
}

export interface AgentRunEnvironmentSelection extends AgentWorkspaceEnvironmentSpec {
  catalogRevision?: string;
}

export interface AgentRunEnvironmentToolchainPack {
  familyId: string;
  versionId: string;
  contentDigest: string;
}

export interface AgentRunEnvironmentRunnerPlugin {
  pluginId: string;
  version: string;
  sdkVersion: string;
  protocolVersion: 3;
  packageHash: string;
  entry: string;
}

export interface AgentRunEnvironmentAcpProfile {
  id: string;
  profileRevision: number;
  argv: string[];
  cwd: string;
}

export interface AgentRunEnvironmentBrowserEndpoint {
  scope: 'docker-network' | 'external-network';
  via: 'backend' | 'runner';
  url: string;
  priority: number;
  allowPlaintext: boolean;
  verifyTls: boolean;
}

export interface AgentRunEnvironmentBrowserTarget {
  id: string;
  profileRevision: number;
  endpoints: AgentRunEnvironmentBrowserEndpoint[];
  allowedUrlPatterns: string[];
}

/** Server-resolved, immutable Workspace environment frozen into one Run definition. */
export interface AgentRunEnvironmentSnapshot {
  kind: AgentWorkspaceKind;
  recipeId: string;
  recipeRevision: string;
  runtimeDigest: string;
  catalogRevision: string;
  toolchain: AgentRunEnvironmentToolchainPack[];
  runnerPlugins: AgentRunEnvironmentRunnerPlugin[];
  acpProfiles: AgentRunEnvironmentAcpProfile[];
  browserTarget: AgentRunEnvironmentBrowserTarget | null;
}

export type Actor =
  | { kind: 'user'; userId: number }
  | {
      kind: 'agent';
      userId: number;
      appId: string;
      runId: string;
      agentRuntimeId: string;
    };

export interface PageRequest {
  limit: number;
  before?: string;
}

export interface ClockPort {
  nowUnixSeconds(): number;
  nowUnixMilliseconds(): number;
}

export const systemClock: ClockPort = {
  nowUnixSeconds: () => Math.floor(Date.now() / 1000),
  nowUnixMilliseconds: () => Date.now(),
};
