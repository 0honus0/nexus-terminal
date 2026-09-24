import type { AgentJsonValueDto } from '@nexus-terminal/protocol/agent-common';
import type {
  AgentApprovalBatchViewModel,
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

export const PLUGIN_FRONTEND_BACKEND_MUTATION_RPC_METHODS = [
  'storage.put',
  'storage.delete',
  'intents.create',
  'intents.revoke',
] as const;

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

export const PLUGIN_FRONTEND_AGENT_MUTATION_RPC_METHODS = [
  'agent.threads.create',
  'agent.threads.rename',
  'agent.runs.create',
  'agent.runs.appendInput',
  'agent.runs.cancel',
  'agent.subagents.cancel',
  'agent.approvals.resolve',
] as const;

export const PLUGIN_FRONTEND_MUTATION_RPC_METHODS = [
  ...PLUGIN_FRONTEND_BACKEND_MUTATION_RPC_METHODS,
  ...PLUGIN_FRONTEND_AGENT_MUTATION_RPC_METHODS,
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
    put(
      key: string,
      value: AgentJsonValueDto,
      expectedVersion: number | null,
      operationId?: string,
    ): Promise<PluginFrontendStorageRecord>;
    delete(key: string, expectedVersion: number, operationId?: string): Promise<boolean>;
  };
  intents: {
    create(
      input: {
        receiverAppId: string;
        intentId: string;
        input: AgentJsonValueDto;
        artifactRefs?: Array<{ appId: string; id: string }>;
        confirmed: true;
      },
      operationId?: string,
    ): Promise<AgentAppIntentReceiptDto>;
    listReceived(limit?: number): Promise<AgentAppIntentReceiptDto[]>;
    revoke(receiptId: string, operationId?: string): Promise<void>;
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
      create(title?: string, operationId?: string): Promise<AgentThreadViewDto>;
      rename(threadId: string, title: string, expectedVersion: number, operationId?: string): Promise<AgentThreadViewDto>;
      entries(threadId: string, before?: string): Promise<AgentLedgerPageDto>;
    };
    runs: {
      list(threadId?: string): Promise<AgentRunPageDto>;
      get(runId: string): Promise<AgentRunSnapshotDto>;
      create(
        input: {
          threadId: string;
          text: string;
          artifactRefs?: string[];
          agentDefinitionId: string;
          model: { providerId: string; modelId: string; configurationVersion: number };
          reasoningEffort?: AgentReasoningEffortDto;
          connectionIds?: number[];
          initialGoal?: string;
        },
        operationId?: string,
      ): Promise<AgentRunViewDto>;
      appendInput(runId: string, text: string, artifactRefs?: string[], operationId?: string): Promise<void>;
      cancel(runId: string, operationId?: string): Promise<AgentRunViewDto>;
      subscribe(runId: string, cursor?: number): Promise<PluginFrontendRunSubscription>;
      unsubscribe(subscriptionId: string): Promise<void>;
    };
    subagents: {
      list(runId: string, before?: string): Promise<AgentSubagentPageDto>;
      messages(runId: string, delegationId: string, before?: string): Promise<AgentSubagentMessagePageDto>;
      cancel(runId: string, delegationId: string, operationId?: string): Promise<AgentSubagentViewDto>;
    };
    approvals: {
      list(runId: string): Promise<AgentApprovalBatchViewModel>;
      resolve(
        approvalId: string,
        runId: string,
        decision: 'approved' | 'denied',
        operationId?: string,
      ): Promise<AgentApprovalViewDto>;
    };
  };
}
