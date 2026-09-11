import type { ClockPort, Scope } from '../../agent.types';
import { requestHash, requireIdempotencyKey } from '../runs/idempotency';
import type { RunSnapshotReaderPort } from '../runs/run.repository.port';
import type { ApprovalDecisionCommitPort } from '../runs/state-commit.port';
import type { RunView } from '../runs/run.types';
import type { ApprovalRepositoryPort, ApprovalView } from './approval.repository.port';

export class ApprovalService {
  constructor(
    private readonly approvals: ApprovalRepositoryPort,
    private readonly runs: RunSnapshotReaderPort,
    private readonly stateCommit: ApprovalDecisionCommitPort,
    private readonly clock: ClockPort,
    private readonly onResolved: (run: RunView) => void,
  ) {}

  async get(scope: Scope, approvalId: string): Promise<ApprovalView> {
    const approval = await this.approvals.get(scope, approvalId);
    if (!approval) throw new Error('NOT_FOUND');
    return approval;
  }

  list(scope: Scope, runId: string): Promise<ApprovalView[]> {
    return this.approvals.list(scope, runId);
  }

  async resolve(
    scope: Scope,
    approvalId: string,
    decision: 'approved' | 'denied',
    operationHash: string,
    expectedVersion: number,
    actorUserId: number,
    idempotencyKey: string,
  ): Promise<ApprovalView> {
    if (
      !['approved', 'denied'].includes(decision) ||
      !operationHash ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    const approval = await this.get(scope, approvalId);
    const run = await this.runs.snapshot(scope, approval.runId);
    if (!run) throw new Error('NOT_FOUND');
    const key = requireIdempotencyKey(idempotencyKey);
    const committed = await this.stateCommit.resolveToolApproval({
      scope,
      runId: approval.runId,
      approvalId,
      decision,
      operationHash,
      expectedApprovalVersion: expectedVersion,
      expectedRunVersion: run.version,
      expectedPolicyRevision: approval.policyRevision,
      expectedInputRevision: approval.inputRevision,
      decidedByUserId: actorUserId,
      idempotencyKey: key,
      requestHash: requestHash(1, {
        approvalId,
        runId: approval.runId,
        decision,
        operationHash,
        expectedVersion,
      }),
      now: this.clock.nowUnixSeconds(),
    });
    this.onResolved(committed.run);
    const resolved = await this.approvals.get(scope, approvalId);
    if (!resolved) throw new Error('NOT_FOUND');
    return resolved;
  }
}
