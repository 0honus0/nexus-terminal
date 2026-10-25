import type { AgentReasoningEffort } from '@nexus-terminal/shared/agent/providers/values';
import type { AppDeclaration, AgentThread } from './scope-types.js';
import type { ThreadPage } from './thread-types.js';
import type { AvailableModel } from '../../providers/model/provider-types.js';
import type { AgentRun, RunEventPage, RunPage } from '../../runs/model/run-types.js';
import type { Participant, MessageMetadataPage } from '../../runs/model/run-collaboration-types.js';
import type { Approval } from '../../governance/model/governance-types.js';
import type { CreateRunResult, CancelRunResult } from '../../runs/model/run-types.js';
import type { AgentApprovalDecision } from '@nexus-terminal/shared/agent/governance/values';
import type { ThreadEntryCursor, ThreadEntries } from '../../context/model/context-types.js';

export type WorkspaceMutation = <T>(work: () => Promise<T>) => Promise<T>;

export interface WorkspaceRunInput {
	prompt: string;
	connectionIds: number[];
	model: {
		providerId: string;
		modelId: string;
		configurationVersion: number;
		reasoningEffort?: AgentReasoningEffort;
	};
}

export interface WorkspaceApprovalInput {
	decision: AgentApprovalDecision;
	operationHash: string;
	expectedVersion: number;
	feedback?: string;
}

export interface DeletedThread {
	appId: string;
	threadId: string;
}

export type WorkspaceInput =
	| {
			method: 'agent.runs.appendInput';
			runId: string;
			expectedVersion: number;
			threadId: string;
			operationId: string;
			input: WorkspaceRunInput;
	  }
	| { method: 'agent.threads.entries'; threadId: string; after: ThreadEntryCursor; limit: number }
	| { method: 'agent.runs.create'; threadId: string; operationId: string; input: WorkspaceRunInput }
	| { method: 'agent.runs.cancel'; runId: string; operationId: string; expectedVersion: number }
	| { method: 'agent.subagents.cancel'; runId: string; childId: string; operationId: string; expectedVersion: number }
	| { method: 'agent.approvals.resolve'; approvalId: string; operationId: string; input: WorkspaceApprovalInput }
	| { method: 'agent.definitions.list' | 'agent.providers.list' }
	| { method: 'agent.threads.list'; after: string | null; limit: number }
	| { method: 'agent.threads.create'; operationId: string; title: string }
	| { method: 'agent.threads.rename'; threadId: string; expectedVersion: number; operationId: string; title: string }
	| { method: 'agent.threads.delete'; threadId: string; expectedVersion: number }
	| { method: 'agent.runs.list'; threadId: string; after: number; limit: number }
	| { method: 'agent.runs.get'; runId: string }
	| { method: 'agent.runs.events'; runId: string; after: number; limit: number }
	| { method: 'agent.subagents.list' | 'agent.approvals.list'; runId: string }
	| { method: 'agent.subagents.messages'; runId: string; childId: string; after: number; limit: number };

export type WorkspaceResult =
	| { method: 'agent.threads.entries'; value: ThreadEntries }
	| { method: 'agent.runs.create' | 'agent.runs.appendInput'; value: CreateRunResult }
	| { method: 'agent.runs.cancel' | 'agent.subagents.cancel'; value: CancelRunResult }
	| { method: 'agent.approvals.resolve'; value: Approval }
	| { method: 'agent.definitions.list'; value: AppDeclaration[] }
	| { method: 'agent.providers.list'; value: AvailableModel[] }
	| { method: 'agent.threads.list'; value: ThreadPage }
	| { method: 'agent.threads.create' | 'agent.threads.rename'; value: AgentThread }
	| { method: 'agent.threads.delete'; value: DeletedThread }
	| { method: 'agent.runs.list'; threadId: string; value: RunPage }
	| { method: 'agent.runs.get'; value: AgentRun | null }
	| { method: 'agent.runs.events'; value: RunEventPage }
	| { method: 'agent.subagents.list'; value: Participant[] }
	| { method: 'agent.subagents.messages'; value: MessageMetadataPage }
	| { method: 'agent.approvals.list'; value: Approval[] };
