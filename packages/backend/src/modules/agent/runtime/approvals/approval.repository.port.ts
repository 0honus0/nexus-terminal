import type { Scope } from '../../agent.types';
import type { ToolInspection } from '../../capabilities/tool.types';

// Port contract rule: durable side-effect methods need a concrete orchestration owner and caller.
// Do not retain unused mutation methods "for later"; delete them so StateCommit remains the sole mutation authority.

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

export interface ApprovalRepositoryPort {
  get(scope: Scope, approvalId: string): Promise<ApprovalView | null>;
  list(scope: Scope, runId: string): Promise<ApprovalView[]>;
}
