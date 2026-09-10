import type { Scope } from '../../agent.types';
import type { ToolInspection } from '../../capabilities/tool.types';

export type ApprovalStatus = 'requested' | 'approved' | 'denied' | 'expired' | 'superseded';

export interface ApprovalView {
  id: string;
  userId: number;
  appId: string;
  runId: string;
  toolCallId: string;
  requestedByRuntimeId: string;
  operationHash: string;
  operationHashVersion: 1;
  status: ApprovalStatus;
  policyRevision: number;
  inputRevision: number;
  decidedByUserId: number | null;
  decidedAt: number | null;
  consumedAt: number | null;
  requestedAt: number;
  expiresAt: number;
  version: number;
  inspection: ToolInspection;
}

export interface RequestApprovalInput {
  scope: Scope;
  id: string;
  runId: string;
  toolCallId: string;
  requestedByRuntimeId: string;
  inspection: ToolInspection;
  requestedAt: number;
  expiresAt: number;
}

export interface ResolveApprovalInput {
  scope: Scope;
  approvalId: string;
  decision: 'approved' | 'denied';
  operationHash: string;
  expectedVersion: number;
  expectedPolicyRevision: number;
  expectedInputRevision: number;
  decidedByUserId: number;
  decidedAt: number;
}

export interface ApprovalRepositoryPort {
  request(input: RequestApprovalInput): Promise<ApprovalView>;
  get(scope: Scope, approvalId: string): Promise<ApprovalView | null>;
  list(scope: Scope, runId: string): Promise<ApprovalView[]>;
  resolve(input: ResolveApprovalInput): Promise<ApprovalView>;
  consume(
    scope: Scope,
    approvalId: string,
    operationHash: string,
    expectedVersion: number,
    now: number,
  ): Promise<ApprovalView>;
  expire(now: number): Promise<number>;
  supersedeRun(scope: Scope, runId: string, inputRevision: number, now: number): Promise<number>;
}
