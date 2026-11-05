import type { AgentApprovalDecision } from '@nexus-terminal/shared/agent/governance/values';
import type { NativeApproval, NativeRun } from './native-run-types';

/** A mounted native surface's presentation and narrow actions; the runtime remains authoritative. */
export interface AgentTaskActivity {
	appId: string;
	appVersion: number;
	threadTitle: string;
	runId: string;
	locallyStarted: boolean;
	status: NativeRun['status'];
	preview: string;
	approvals: NativeApproval[];
	targetLabels: ReadonlyMap<number, string>;
	toolExecutions: number | null;
	blocked: boolean;
	failureMessage: string;
	failureKey: string;
	open(): void;
	decide(approval: NativeApproval, decision: AgentApprovalDecision): void;
}

export interface AgentTaskActivityRegistration {
	update(activity: AgentTaskActivity | null): void;
	dispose(): void;
}
