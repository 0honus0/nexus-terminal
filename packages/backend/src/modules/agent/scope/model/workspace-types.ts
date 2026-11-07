import type {
	OperationContentReference,
	OperationContentPage,
} from '../../operations/model/operation-content-types.js';
import type { AppDeclaration, AgentThread } from './scope-types.js';
import type { ThreadPage } from './thread-types.js';
import type { AvailableModel } from '../../providers/model/provider-types.js';
import type { AgentRun, RunEventPage, RunPage } from '../../runs/model/run-types.js';
import type { Participant, MessageMetadataPage } from '../../runs/model/run-collaboration-types.js';
import type { OperationApproval, OperationApprovalPage } from '../../governance/model/operation-approval-types.js';
import type { CreateRunResult, CancelRunResult } from '../../runs/model/run-types.js';
import type { AgentApprovalDecision } from '@nexus-terminal/shared/agent/governance/values';
import type { ThreadEntryCursor, ThreadEntries, ThreadEntryHistory } from '../../context/model/context-types.js';
import type { ResumeRunResult, RunSuspension } from '../../runs/model/run-resume-types.js';

export type WorkspaceMutation = <T>(work: () => Promise<T>) => Promise<T>;

export interface WorkspaceRunInput {
	approvalMode: import('@nexus-terminal/shared/agent/runs/values').AgentApprovalMode;
	prompt: string;
	connectionIds: number[];
	inputJson: string;
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

export type WorkspaceInput = UiWorkspaceInput | CoreWorkspaceInput;

export type CoreWorkspaceInput =
	| { method: 'agent.runs.outputs'; runId: string }
	| { method: 'agent.content.read'; runId: string; reference: OperationContentReference; index: number }
	| { method: 'agent.runs.resume'; runId: string; operationId: string; expectedVersion: number; inputJson: string }
	| { method: 'agent.runs.suspension'; runId: string }
	| {
			method: 'agent.runs.appendInput';
			runId: string;
			expectedVersion: number;
			threadId: string;
			operationId: string;
			input: WorkspaceRunInput;
	  }
	| { method: 'agent.threads.entries'; threadId: string; after: ThreadEntryCursor; limit: number }
	| { method: 'agent.threads.history'; threadId: string; before: ThreadEntryCursor | null; limit: number }
	| { method: 'agent.runs.create'; threadId: string; operationId: string; input: WorkspaceRunInput }
	| { method: 'agent.runs.cancel'; runId: string; operationId: string; expectedVersion: number }
	| { method: 'agent.subagents.cancel'; runId: string; childId: string; operationId: string; expectedVersion: number }
	| { method: 'agent.approvals.resolve'; approvalId: string; operationId: string; input: WorkspaceApprovalInput }
	| { method: 'agent.definitions.list' | 'agent.providers.list' }
	| { method: 'agent.threads.list'; after: string | null; limit: number }
	| { method: 'agent.threads.create'; operationId: string; title: string; autoTitle: boolean }
	| { method: 'agent.threads.rename'; threadId: string; expectedVersion: number; operationId: string; title: string }
	| { method: 'agent.threads.delete'; threadId: string; expectedVersion: number }
	| { method: 'agent.runs.list'; threadId: string; after: number; limit: number }
	| { method: 'agent.runs.get'; runId: string }
	| { method: 'agent.runs.events'; runId: string; after: number; limit: number }
	| { method: 'agent.subagents.list'; runId: string }
	| { method: 'agent.approvals.list'; runId: string; after: string | null }
	| { method: 'agent.subagents.messages'; runId: string; childId: string; after: number; limit: number };

export type WorkspaceResult = UiWorkspaceResult | CoreWorkspaceResult;

export type CoreWorkspaceResult =
	| { method: 'agent.runs.outputs'; value: OperationContentReference[] | null }
	| { method: 'agent.content.read'; value: OperationContentPage }
	| { method: 'agent.runs.resume'; value: ResumeRunResult }
	| { method: 'agent.runs.suspension'; value: RunSuspension | null }
	| { method: 'agent.threads.entries'; value: ThreadEntries }
	| { method: 'agent.threads.history'; value: ThreadEntryHistory }
	| { method: 'agent.runs.create' | 'agent.runs.appendInput'; value: CreateRunResult }
	| { method: 'agent.runs.cancel' | 'agent.subagents.cancel'; value: CancelRunResult }
	| { method: 'agent.approvals.resolve'; value: OperationApproval }
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
	| { method: 'agent.approvals.list'; value: OperationApprovalPage };

export type UiWorkspaceInput =
	| { method: 'agent.runs.usage'; runId: string }
	| {
			method: 'agent.tools.list';
			threadId: string;
			before: import('../../operations/model/operation-activity-types.js').OperationActivityCursor | null;
			limit: number;
	  }
	| { method: 'agent.tools.details'; runId: string; toolId: string }
	| { method: 'agent.memories.list'; query: import('../../memory/model/memory-types.js').MemoryQuery }
	| { method: 'agent.memories.get'; memoryId: string }
	| {
			method: 'agent.memories.review';
			memoryId: string;
			input: import('../../memory/model/memory-types.js').MemoryReview;
	  }
	| {
			method: 'agent.artifacts.list';
			query: Omit<import('../../artifacts/model/artifact-types.js').ArtifactQuery, 'appId'>;
	  }
	| { method: 'agent.artifacts.get'; artifactId: string }
	| { method: 'agent.artifacts.begin'; input: import('../../artifacts/model/artifact-types.js').ArtifactBegin }
	| { method: 'agent.artifacts.retain'; artifactId: string; expectedVersion: number; retained: boolean }
	| { method: 'agent.artifacts.delete'; artifactId: string; expectedVersion: number }
	| {
			method: 'agent.artifacts.attach';
			artifactId: string;
			expectedVersion: number;
			threadId: string;
			runId: string | null;
	  }
	| {
			method: 'agent.artifacts.readRange';
			artifactId: string;
			expectedVersion: number;
			start: number;
			endInclusive: number;
	  };

export type UiWorkspaceResult = { appId: string } & (
	| { method: 'agent.runs.usage'; value: import('../../runs/model/run-types.js').RunUsage }
	| {
			method: 'agent.tools.list';
			value: import('../../operations/model/operation-activity-types.js').OperationActivityPage;
	  }
	| {
			method: 'agent.tools.details';
			value: import('../../operations/model/operation-activity-types.js').OperationActivity;
	  }
	| {
			method: 'agent.memories.list';
			value: { items: import('../../memory/model/memory-types.js').MemoryRecord[]; nextOffset: number | null };
	  }
	| {
			method: 'agent.memories.get' | 'agent.memories.review';
			value: import('../../memory/model/memory-types.js').MemoryRecord;
	  }
	| {
			method: 'agent.artifacts.list';
			value: {
				items: import('../../artifacts/model/artifact-types.js').ArtifactRecord[];
				nextOffset: number | null;
			};
	  }
	| {
			method: 'agent.artifacts.get' | 'agent.artifacts.begin' | 'agent.artifacts.retain';
			value: import('../../artifacts/model/artifact-types.js').ArtifactRecord;
	  }
	| { method: 'agent.artifacts.delete'; value: { deleted: true } }
	| {
			method: 'agent.artifacts.attach';
			value: {
				artifact: import('../../artifacts/model/artifact-types.js').ArtifactRecord;
				targetAppId: string;
				threadId: string;
				runId: string | null;
			};
	  }
	| {
			method: 'agent.artifacts.readRange';
			value: {
				artifactId: string;
				start: number;
				endInclusive: number;
				bytes: Uint8Array;
				version: number;
				totalBytes: number;
			};
	  }
);

export function isUiWorkspaceInput(input: WorkspaceInput): input is UiWorkspaceInput {
	return (
		input.method === 'agent.runs.usage' ||
		input.method.startsWith('agent.tools.') ||
		input.method.startsWith('agent.memories.') ||
		input.method.startsWith('agent.artifacts.')
	);
}

export function isUiWorkspaceResult(input: WorkspaceResult): input is UiWorkspaceResult {
	return (
		input.method === 'agent.runs.usage' ||
		input.method.startsWith('agent.tools.') ||
		input.method.startsWith('agent.memories.') ||
		input.method.startsWith('agent.artifacts.')
	);
}
