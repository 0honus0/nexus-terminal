import { logErrorCode, logger } from '../../../../shared/logging/logger';
import type { ClockPort, Scope } from '../../agent.types';
import { requestHash, requireIdempotencyKey } from '../runs/idempotency';
import type { RunSnapshotReaderPort } from '../runs/run.repository.port';
import type { ApprovalDecisionCommitPort } from '../runs/state-commit.port';
import type { RunView } from '../runs/run.types';
import type { AcpPermissionResolutionPort } from './acp-permission-broker';
import type { ApprovalRepositoryPort, ApprovalView } from './approval.repository.port';

export class ApprovalService {
  constructor(
    private readonly approvals: ApprovalRepositoryPort,
    private readonly runs: RunSnapshotReaderPort,
    private readonly stateCommit: ApprovalDecisionCommitPort,
    private readonly clock: ClockPort,
    private readonly onResolved: (run: RunView) => void,
    private readonly acpPermissions?: AcpPermissionResolutionPort,
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
    feedback?: string,
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
    const acpResolution =
      approval.kind === 'acp_permission' && approval.status === 'requested'
        ? (this.acpPermissions?.take(approvalId) ?? null)
        : null;
    if (approval.kind === 'acp_permission' && approval.status === 'requested' && !acpResolution) {
      logger.warn(
        { userId: scope.userId, appId: scope.appId, runId: approval.runId, approvalId, approvalKind: approval.kind },
        'Agent approval resolution rejected as stale',
      );
      throw new Error('APPROVAL_STALE');
    }
    logger.debug(
      {
        userId: scope.userId,
        appId: scope.appId,
        runId: approval.runId,
        approvalId,
        approvalKind: approval.kind,
        decision,
        expectedVersion,
      },
      'Agent approval resolution started',
    );
    let committed: Awaited<ReturnType<ApprovalDecisionCommitPort['resolveToolApproval']>>;
    try {
      committed = await this.stateCommit.resolveToolApproval({
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
        ...(feedback ? { feedback } : {}),
        idempotencyKey: key,
        requestHash: requestHash(1, {
          approvalId,
          runId: approval.runId,
          decision,
          operationHash,
          expectedVersion,
          ...(feedback ? { feedback } : {}),
        }),
        now: this.clock.nowUnixSeconds(),
      });
    } catch (error) {
      try {
        await acpResolution?.failClosed();
      } catch (failClosedError) {
        logger.error(
          {
            userId: scope.userId,
            appId: scope.appId,
            runId: approval.runId,
            approvalId,
            approvalKind: approval.kind,
            errorCode: logErrorCode(failClosedError, 'APPROVAL_FAIL_CLOSED_FAILED'),
          },
          'Agent approval fail-closed transition failed',
        );
        throw failClosedError;
      }
      logger.warn(
        {
          userId: scope.userId,
          appId: scope.appId,
          runId: approval.runId,
          approvalId,
          approvalKind: approval.kind,
          decision,
          errorCode: logErrorCode(error, 'APPROVAL_RESOLUTION_FAILED'),
        },
        'Agent approval resolution failed',
      );
      throw error;
    }
    if (approval.kind === 'acp_permission') {
      acpResolution?.finish(decision === 'approved' ? 'allow_once' : 'reject_once');
    } else {
      this.onResolved(committed.run);
    }
    const resolved = await this.approvals.get(scope, approvalId);
    if (!resolved) throw new Error('NOT_FOUND');
    logger.info(
      {
        userId: scope.userId,
        appId: scope.appId,
        runId: approval.runId,
        approvalId,
        approvalKind: approval.kind,
        decision,
        status: resolved.status,
        version: resolved.version,
      },
      'Agent approval resolved',
    );
    return resolved;
  }
}
