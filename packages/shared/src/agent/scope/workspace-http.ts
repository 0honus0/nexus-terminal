import type { AgentAppDefinitionView, AgentThreadView } from './model.js';
import type { AgentRunView } from '../runs/model.js';
import type { AgentProviderProtocol, AgentReasoningEffort } from '../providers/values.js';
import type { AgentRunEventsResponse } from '../runs/http.js';
import type { AgentChildrenResponse, AgentMessageMetadataResponse } from '../collaboration/http.js';
import type { AgentApprovalView, AgentApprovalPage } from '../governance/model.js';
import type { AgentCreateRunRequest, AgentCreateRunResponse, AgentCancelRunResponse } from '../runs/http.js';
import type { AgentApprovalResolveRequest } from '../governance/http.js';
import type { AgentThreadEntryCursor, AgentThreadEntries } from './model.js';

export interface AgentSelectableModel {
	providerId: string;
	providerDisplayName: string;
	configurationVersion: number;
	modelId: string;
	protocol: AgentProviderProtocol;
	reasoningEfforts: AgentReasoningEffort[];
	defaultReasoningEffort?: AgentReasoningEffort;
	reasoningMandatory: boolean;
}

export interface AgentDeleteThreadResponse {
	appId: string;
	threadId: string;
}

export type AgentWorkspaceInput =
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
	| { method: 'agent.threads.create'; params: { operationId: string; title: string; autoTitle: boolean } }
	| {
			method: 'agent.threads.rename';
			params: { threadId: string; expectedVersion: number; operationId: string; title: string };
	  }
	| { method: 'agent.threads.delete'; params: { threadId: string; expectedVersion: number } }
	| { method: 'agent.runs.list'; params: { threadId: string; after: number; limit: number } }
	| { method: 'agent.runs.get'; params: { runId: string } }
	| { method: 'agent.runs.events'; params: { runId: string; after: number; limit: number } }
	| { method: 'agent.subagents.list'; params: { runId: string } }
	| { method: 'agent.approvals.list'; params: { runId: string; after: string | null } }
	| { method: 'agent.subagents.messages'; params: { runId: string; childId: string; after: number; limit: number } };

export type AgentWorkspaceResult =
	| { method: 'agent.threads.entries'; value: AgentThreadEntries }
	| { method: 'agent.runs.create' | 'agent.runs.appendInput'; value: AgentCreateRunResponse }
	| { method: 'agent.runs.cancel' | 'agent.subagents.cancel'; value: AgentCancelRunResponse }
	| { method: 'agent.approvals.resolve'; value: AgentApprovalView }
	| { method: 'agent.definitions.list'; value: AgentAppDefinitionView[] }
	| { method: 'agent.providers.list'; value: AgentSelectableModel[] }
	| { method: 'agent.threads.list'; value: { items: AgentThreadView[]; nextCursor: string | null } }
	| { method: 'agent.threads.create' | 'agent.threads.rename'; value: AgentThreadView }
	| { method: 'agent.threads.delete'; value: AgentDeleteThreadResponse }
	| { method: 'agent.runs.list'; value: { threadId: string; items: AgentRunView[]; nextCursor: number } }
	| { method: 'agent.runs.get'; value: AgentRunView | null }
	| { method: 'agent.runs.events'; value: AgentRunEventsResponse }
	| { method: 'agent.subagents.list'; value: AgentChildrenResponse }
	| { method: 'agent.subagents.messages'; value: AgentMessageMetadataResponse }
	| { method: 'agent.approvals.list'; value: AgentApprovalPage };

export interface AgentWorkspaceRequest {
	appVersion: number;
	request: AgentWorkspaceInput;
}

export interface AgentWorkspaceResponse {
	appId: string;
	appVersion: number;
	result: AgentWorkspaceResult;
}
