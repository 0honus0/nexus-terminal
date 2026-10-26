import type { AgentReasoningEffort } from '@nexus-terminal/shared/agent/providers/values';
import type { AgentAppView, AgentAppDefinitionView, AgentThreadView } from '@nexus-terminal/shared/agent/scope/model';
import type { AgentRunUsageView, AgentRunView } from '@nexus-terminal/shared/agent/runs/model';
import type { AgentRunEventsResponse } from '@nexus-terminal/shared/agent/runs/http';
import type { AgentCreateRunOutcome, AgentCancelRunOutcome } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentThreadToolsResponse } from '@nexus-terminal/shared/agent/tools/http';
import type {
	AgentChildrenResponse,
	AgentMessageMetadataResponse,
} from '@nexus-terminal/shared/agent/collaboration/http';

/** Trusted backend inputs: identity comes from authentication, not a request body. */
export interface AgentCreateRunInput {
	approvalMode: import('@nexus-terminal/shared/agent/runs/values').AgentApprovalMode;
	connectionIds: number[];
	model: {
		providerId: string;
		modelId: string;
		configurationVersion: number;
		reasoningEffort?: AgentReasoningEffort;
	};
	userId: number;
	appId: string;
	threadId: string;
	prompt: string;
	operationKey: string;
}

export interface AgentCancelRunInput {
	userId: number;
	appId: string;
	runId: string;
	expectedVersion: number;
	operationKey: string;
}

export type AgentCreateRunResult =
	| { status: AgentCreateRunOutcome; run: AgentRunView }
	| { status: 'replayed'; originalStatus: AgentCreateRunOutcome; run: AgentRunView }
	| { status: 'scope_not_found' | 'active_run_conflict' | 'idempotency_conflict' | 'provider_unavailable' };

export type AgentCancelRunResult =
	| { status: AgentCancelRunOutcome; run: AgentRunView }
	| { status: 'replayed'; originalStatus: AgentCancelRunOutcome; run: AgentRunView }
	| { status: 'not_found' | 'version_conflict' | 'idempotency_conflict' | 'active_run_conflict' };

export interface AgentStateApi {
	listChildren(userId: number, appId: string, runId: string): Promise<AgentChildrenResponse | null>;
	listChildMessages(
		userId: number,
		appId: string,
		runId: string,
		childId: string,
		after: number,
		limit: number,
	): Promise<AgentMessageMetadataResponse | null>;
	cancelChild(input: AgentCancelRunInput, childId: string): Promise<AgentCancelRunResult>;
	listApps(userId: number): Promise<AgentAppView[]>;
	getApp(userId: number, appId: string): Promise<AgentAppView | null>;
	setAppEnabled(
		userId: number,
		appId: string,
		enabled: boolean,
		expectedVersion: number,
	): Promise<AgentAppView | null>;
	listAppDefinitions(): Promise<AgentAppDefinitionView[]>;
	createApp(userId: number, name: string, definitionId?: string): Promise<AgentAppView>;
	createThread(userId: number, appId: string, title: string): Promise<AgentThreadView | null>;
	createRun(input: AgentCreateRunInput): Promise<AgentCreateRunResult>;
	cancelRun(input: AgentCancelRunInput): Promise<AgentCancelRunResult>;
	getRun(userId: number, appId: string, runId: string): Promise<AgentRunView | null>;
	listThreadTools(
		userId: number,
		appId: string,
		threadId: string,
		before: { createdAt: number; id: string } | null,
		limit: number,
	): Promise<AgentThreadToolsResponse | null>;
	listEvents(
		userId: number,
		appId: string,
		runId: string,
		after: number,
		limit: number,
	): Promise<AgentRunEventsResponse | null>;
	getUsage(userId: number, appId: string, runId: string): Promise<AgentRunUsageView | null>;
}
