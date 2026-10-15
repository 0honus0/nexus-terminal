import type { AgentPluginRpcInput, AgentPluginRpcResult } from './events.js';
import type { AgentHttpErrorCode } from '../values.js';
import type { AgentAppDefinitionView, AgentThreadView } from '../scope/model.js';
import type { AgentRunView } from '../runs/model.js';
import type { AgentProviderProtocol } from '../providers/values.js';
import type { AgentRunEventsResponse } from '../runs/http.js';
import type { AgentChildrenResponse, AgentMessageMetadataResponse } from '../collaboration/http.js';
import type { AgentApprovalView } from '../governance/model.js';
import type { AgentCreateRunRequest, AgentCreateRunResponse, AgentCancelRunResponse } from '../runs/http.js';
import type { AgentApprovalResolveRequest } from '../governance/http.js';
import type { AgentThreadEntryCursor, AgentThreadEntries } from '../scope/model.js';

export interface AgentPluginSelectableModel {
	providerId: string;
	providerDisplayName: string;
	configurationVersion: number;
	modelId: string;
	protocol: AgentProviderProtocol;
}

export type AgentPluginAgentInput =
	| {
			method: 'agent.runs.appendInput';
			params: {
				runId: string;
				expectedVersion: number;
				threadId: string;
				operationId: string;
				input: AgentCreateRunRequest;
			};
	  }
	| { method: 'agent.threads.entries'; params: { threadId: string; after: AgentThreadEntryCursor; limit: number } }
	| { method: 'agent.runs.create'; params: { threadId: string; operationId: string; input: AgentCreateRunRequest } }
	| { method: 'agent.runs.cancel'; params: { runId: string; operationId: string; expectedVersion: number } }
	| {
			method: 'agent.subagents.cancel';
			params: { runId: string; childId: string; operationId: string; expectedVersion: number };
	  }
	| {
			method: 'agent.approvals.resolve';
			params: { approvalId: string; operationId: string; input: AgentApprovalResolveRequest };
	  }
	| { method: 'agent.definitions.list' | 'agent.providers.list'; params: Record<string, never> }
	| { method: 'agent.threads.list'; params: { after: string | null; limit: number } }
	| { method: 'agent.threads.create'; params: { operationId: string; title: string } }
	| {
			method: 'agent.threads.rename';
			params: { threadId: string; expectedVersion: number; operationId: string; title: string };
	  }
	| { method: 'agent.runs.list'; params: { threadId: string; after: number; limit: number } }
	| { method: 'agent.runs.get'; params: { runId: string } }
	| { method: 'agent.runs.events'; params: { runId: string; after: number; limit: number } }
	| { method: 'agent.subagents.list' | 'agent.approvals.list'; params: { runId: string } }
	| { method: 'agent.subagents.messages'; params: { runId: string; childId: string; after: number; limit: number } };

export type AgentPluginAgentResult =
	| { method: 'agent.threads.entries'; value: AgentThreadEntries }
	| { method: 'agent.runs.create' | 'agent.runs.appendInput'; value: AgentCreateRunResponse }
	| { method: 'agent.runs.cancel' | 'agent.subagents.cancel'; value: AgentCancelRunResponse }
	| { method: 'agent.approvals.resolve'; value: AgentApprovalView }
	| { method: 'agent.definitions.list'; value: AgentAppDefinitionView[] }
	| { method: 'agent.providers.list'; value: AgentPluginSelectableModel[] }
	| { method: 'agent.threads.list'; value: { items: AgentThreadView[]; nextCursor: string | null } }
	| { method: 'agent.threads.create' | 'agent.threads.rename'; value: AgentThreadView }
	| { method: 'agent.runs.list'; value: { threadId: string; items: AgentRunView[]; nextCursor: number } }
	| { method: 'agent.runs.get'; value: AgentRunView | null }
	| { method: 'agent.runs.events'; value: AgentRunEventsResponse }
	| { method: 'agent.subagents.list'; value: AgentChildrenResponse }
	| { method: 'agent.subagents.messages'; value: AgentMessageMetadataResponse }
	| { method: 'agent.approvals.list'; value: AgentApprovalView[] };

export type AgentPluginFrontendInput = AgentPluginRpcInput | AgentPluginAgentInput;

export type AgentPluginFrontendResult = AgentPluginRpcResult | AgentPluginAgentResult;

export interface AgentPluginRpcEnvelope {
	type: 'nexus.plugin.request';
	protocol: 1;
	nonce: string;
	id: string;
	seq: number;
	request: AgentPluginFrontendInput;
}

export type AgentPluginRpcResponse = {
	type: 'nexus.plugin.response';
	protocol: 1;
	nonce: string;
	id: string;
	seq: number;
} & ({ ok: true; result: AgentPluginFrontendResult } | { ok: false; error: { code: AgentHttpErrorCode } });

export interface AgentPluginFrontendRpcRequest {
	grant: string;
	envelope: AgentPluginRpcEnvelope;
}

export interface AgentPluginInit {
	type: 'nexus.plugin.init';
	protocol: 1;
	nonce: string;
	appId: string;
}

export interface AgentPluginReady {
	type: 'nexus.plugin.ready';
	protocol: 1;
}

export interface AgentPluginAck {
	type: 'nexus.plugin.ack';
	protocol: 1;
	nonce: string;
	seq: 0;
}
