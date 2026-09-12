import type {
  AgentApprovalBatch,
  AgentApprovalView,
  AgentDefinitionView,
  AgentLedgerPage,
  AgentProviderView,
  AgentRunPage,
  AgentRunSnapshot,
  AgentRunView,
  AgentSubagentMessagePage,
  AgentSubagentPage,
  AgentSubagentView,
  AgentThreadPage,
  AgentThreadView,
} from '../api/agent-api';
import type { AgentStreamEvent } from '../api/agent-events';

export const PLUGIN_FRONTEND_PROTOCOL_VERSION = 1 as const;

export const PLUGIN_FRONTEND_BACKEND_RPC_METHODS = [
  'host.appInfo',
  'storage.get',
  'storage.put',
  'storage.delete',
] as const;

export const PLUGIN_FRONTEND_AGENT_RPC_METHODS = [
  'agent.definitions.list',
  'agent.providers.list',
  'agent.threads.list',
  'agent.threads.create',
  'agent.threads.entries',
  'agent.runs.list',
  'agent.runs.get',
  'agent.runs.create',
  'agent.runs.appendInput',
  'agent.runs.cancel',
  'agent.runs.subscribe',
  'agent.runs.unsubscribe',
  'agent.subagents.list',
  'agent.subagents.messages',
  'agent.subagents.cancel',
  'agent.approvals.list',
  'agent.approvals.resolve',
] as const;

export const PLUGIN_FRONTEND_RPC_METHODS = [
  ...PLUGIN_FRONTEND_BACKEND_RPC_METHODS,
  ...PLUGIN_FRONTEND_AGENT_RPC_METHODS,
] as const;

export type PluginFrontendBackendRpcMethod = (typeof PLUGIN_FRONTEND_BACKEND_RPC_METHODS)[number];
export type PluginFrontendAgentRpcMethod = (typeof PLUGIN_FRONTEND_AGENT_RPC_METHODS)[number];
export type PluginFrontendRpcMethod = (typeof PLUGIN_FRONTEND_RPC_METHODS)[number];

export interface PluginFrontendAppInfo {
  appId: string;
  version: string;
  sdkVersion: string;
  protocolVersion: typeof PLUGIN_FRONTEND_PROTOCOL_VERSION;
  displayName: string;
  declaredCapabilities: string[];
}

export interface PluginFrontendStorageRecord {
  key: string;
  value: unknown;
  version: number;
  updatedAt: number;
}

export interface PluginFrontendRunSubscription {
  subscriptionId: string;
}

export interface PluginFrontendRunEvent {
  subscriptionId: string;
  event: AgentStreamEvent;
}

export interface PluginFrontendSdkV1 {
  host: {
    appInfo(): Promise<PluginFrontendAppInfo>;
  };
  storage: {
    get(key: string): Promise<PluginFrontendStorageRecord | null>;
    put(key: string, value: unknown, expectedVersion: number | null): Promise<PluginFrontendStorageRecord>;
    delete(key: string, expectedVersion: number): Promise<boolean>;
  };
  agent: {
    definitions: {
      list(): Promise<AgentDefinitionView[]>;
    };
    providers: {
      list(): Promise<AgentProviderView[]>;
    };
    threads: {
      list(before?: string): Promise<AgentThreadPage>;
      create(title?: string): Promise<AgentThreadView>;
      entries(threadId: string, before?: string): Promise<AgentLedgerPage>;
    };
    runs: {
      list(threadId?: string): Promise<AgentRunPage>;
      get(runId: string): Promise<AgentRunSnapshot>;
      create(input: {
        threadId: string;
        text: string;
        artifactRefs?: string[];
        agentDefinitionId: string;
        model: { providerId: string; modelId: string; configurationVersion: number };
        connectionIds?: number[];
        initialGoal?: string;
      }): Promise<AgentRunView>;
      appendInput(runId: string, text: string, artifactRefs?: string[]): Promise<void>;
      cancel(runId: string): Promise<AgentRunView>;
      subscribe(runId: string, cursor?: number): Promise<PluginFrontendRunSubscription>;
      unsubscribe(subscriptionId: string): Promise<void>;
    };
    subagents: {
      list(runId: string, before?: string): Promise<AgentSubagentPage>;
      messages(runId: string, delegationId: string, before?: string): Promise<AgentSubagentMessagePage>;
      cancel(runId: string, delegationId: string): Promise<AgentSubagentView>;
    };
    approvals: {
      list(runId: string): Promise<AgentApprovalBatch>;
      resolve(approvalId: string, runId: string, decision: 'approved' | 'denied'): Promise<AgentApprovalView>;
    };
  };
}
