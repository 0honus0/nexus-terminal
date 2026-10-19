import type { AgentApprovalDecision, AgentCapability } from './values.js';
import type {
	AgentGrantView,
	AgentExecutionPolicyView,
	AgentApprovalView,
	AgentExecutionPolicyOverrides,
	AgentGrantScope,
} from './model.js';

export interface AgentGrantReplaceRequest {
	expectedPolicyRevision: number;
	grants: { capability: AgentCapability; scope: AgentGrantScope }[];
}

export interface AgentExecutionPolicyReplaceRequest {
	expectedVersion: number;
	overrides: AgentExecutionPolicyOverrides;
}

export interface AgentApprovalResolveRequest {
	decision: AgentApprovalDecision;
	operationHash: string;
	expectedVersion: number;
	feedback?: string;
}

export interface AgentGovernanceAppPath {
	appId: string;
}

export interface AgentApprovalPath {
	appId: string;
	approvalId: string;
}

export interface AgentRunApprovalsPath {
	appId: string;
	runId: string;
}

export interface AgentApprovalCommandHeaders {
	operationKey: string;
}

export type AgentGrantResponse = AgentGrantView;

export type AgentExecutionPolicyResponse = AgentExecutionPolicyView;

export type AgentApprovalResponse = AgentApprovalView;

export type AgentApprovalListResponse = AgentApprovalView[];

export interface AgentTargetDenylistReplaceRequest {
	connectionIds: number[];
	reason: string;
	expectedRevision: number;
}

export type AgentTargetDenylistResponse = import('./model.js').AgentTargetDenylistView;
