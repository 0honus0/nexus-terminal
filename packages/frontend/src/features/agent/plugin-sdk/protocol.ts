import type { AgentJsonValueDto } from '@nexus-terminal/protocol/agent-common';
import type {
  AgentApprovalBatch,
  AgentApprovalViewDto,
  AgentAppIntentArtifactDto,
  AgentAppIntentReceiptDto,
  AgentDefinitionViewDto,
  AgentLedgerPageDto,
  AgentProviderViewDto,
  AgentReasoningEffortDto,
  AgentRunPageDto,
  AgentRunSnapshotDto,
  AgentRunViewDto,
  AgentSubagentMessagePageDto,
  AgentSubagentPageDto,
  AgentSubagentViewDto,
  AgentThreadPageDto,
  AgentThreadViewDto,
} from '../api/agent-api';
import type { AgentStreamEvent } from '../api/agent-events';

export const PLUGIN_FRONTEND_PROTOCOL_VERSION = 1 as const;

export const PLUGIN_FRONTEND_BACKEND_RPC_METHODS = [
  'host.appInfo',
  'storage.get',
  'storage.put',
  'storage.delete',
  'intents.create',
  'intents.listReceived',
  'intents.revoke',
  'intents.artifacts.get',
] as const;

export const PLUGIN_FRONTEND_BINARY_RPC_METHODS = ['intents.artifacts.readRange'] as const;

export const PLUGIN_FRONTEND_AGENT_RPC_METHODS = [
  'agent.definitions.list',
  'agent.providers.list',
  'agent.threads.list',
  'agent.threads.create',
  'agent.threads.rename',
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
  ...PLUGIN_FRONTEND_BINARY_RPC_METHODS,
] as const;

export type PluginFrontendBackendRpcMethod = (typeof PLUGIN_FRONTEND_BACKEND_RPC_METHODS)[number];
export type PluginFrontendAgentRpcMethod = (typeof PLUGIN_FRONTEND_AGENT_RPC_METHODS)[number];
export type PluginFrontendBinaryRpcMethod = (typeof PLUGIN_FRONTEND_BINARY_RPC_METHODS)[number];
export type PluginFrontendRpcMethod = (typeof PLUGIN_FRONTEND_RPC_METHODS)[number];

export const PLUGIN_APP_INTENT_ARTIFACT_CHUNK_BYTES = 128 * 1024;

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
  value: AgentJsonValueDto;
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
    put(key: string, value: AgentJsonValueDto, expectedVersion: number | null): Promise<PluginFrontendStorageRecord>;
    delete(key: string, expectedVersion: number): Promise<boolean>;
  };
  intents: {
    create(input: {
      receiverAppId: string;
      intentId: string;
      input: AgentJsonValueDto;
      artifactRefs?: Array<{ appId: string; id: string }>;
      confirmed: true;
    }): Promise<AgentAppIntentReceiptDto>;
    listReceived(limit?: number): Promise<AgentAppIntentReceiptDto[]>;
    revoke(receiptId: string): Promise<void>;
    artifacts: {
      get(receiptId: string, artifactId: string): Promise<AgentAppIntentArtifactDto>;
      readRange(receiptId: string, artifactId: string, start: number, endInclusive: number): Promise<ArrayBuffer>;
    };
  };
  agent: {
    definitions: {
      list(): Promise<AgentDefinitionViewDto[]>;
    };
    providers: {
      list(): Promise<AgentProviderViewDto[]>;
    };
    threads: {
      list(before?: string): Promise<AgentThreadPageDto>;
      create(title?: string): Promise<AgentThreadViewDto>;
      rename(threadId: string, title: string, expectedVersion: number): Promise<AgentThreadViewDto>;
      entries(threadId: string, before?: string): Promise<AgentLedgerPageDto>;
    };
    runs: {
      list(threadId?: string): Promise<AgentRunPageDto>;
      get(runId: string): Promise<AgentRunSnapshotDto>;
      create(input: {
        threadId: string;
        text: string;
        artifactRefs?: string[];
        agentDefinitionId: string;
        model: { providerId: string; modelId: string; configurationVersion: number };
        reasoningEffort?: AgentReasoningEffortDto;
        connectionIds?: number[];
        initialGoal?: string;
      }): Promise<AgentRunViewDto>;
      appendInput(runId: string, text: string, artifactRefs?: string[]): Promise<void>;
      cancel(runId: string): Promise<AgentRunViewDto>;
      subscribe(runId: string, cursor?: number): Promise<PluginFrontendRunSubscription>;
      unsubscribe(subscriptionId: string): Promise<void>;
    };
    subagents: {
      list(runId: string, before?: string): Promise<AgentSubagentPageDto>;
      messages(runId: string, delegationId: string, before?: string): Promise<AgentSubagentMessagePageDto>;
      cancel(runId: string, delegationId: string): Promise<AgentSubagentViewDto>;
    };
    approvals: {
      list(runId: string): Promise<AgentApprovalBatch>;
      resolve(approvalId: string, runId: string, decision: 'approved' | 'denied'): Promise<AgentApprovalViewDto>;
    };
  };
}
