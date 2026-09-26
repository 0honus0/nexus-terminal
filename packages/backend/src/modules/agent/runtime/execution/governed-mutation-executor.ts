import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { logger } from '../../../../shared/logging/logger';
import type { JsonValue, Scope } from '../../agent.types';
import type { ToolPolicyDecision } from '../../capabilities/policy.service';
import type { ToolContext, ToolInspection, ToolResult } from '../../capabilities/tool.types';
import { TOOL_APPROVAL_TTL_SECONDS } from '../approvals/approval-policy';
import { requestHash } from '../runs/idempotency';
import type { RunExecutionReaderPort } from '../runs/run.repository.port';
import type { StateCommitPort, StateCommitResult } from '../runs/state-commit.port';
import type { RunView } from '../runs/run.types';
import { executionErrorCode } from './execution-errors';
import { toolLeaseTtlSeconds } from './tool-lease-policy';
import type { ToolCallRunner } from './tool-call-runner';

const inspectionChanged = (left: ToolInspection, right: ToolInspection): boolean => !isDeepStrictEqual(left, right);

export type GovernedMutationCommitPhase =
  | 'inspection_refreshed'
  | 'approval_requested'
  | 'approval_resolved'
  | 'rejected'
  | 'begun'
  | 'settled'
  | 'lease_reconciliation'
  | 'loop_guard';

export interface GovernedMutationIdentity {
  scope: Scope;
  runId: string;
  runtimeId: string;
  toolStepId: string;
  toolCallId: string;
}

export interface GovernedMutationFailure {
  phase: 'reinspect' | 'approval_refresh' | 'duplicate_guard' | 'lease_acquire';
  error: unknown;
  errorCode: string;
  inspection: ToolInspection;
  previousInspection: ToolInspection;
  duplicate?: { toolCallId: string; providerCallId: string };
}

export interface GovernedMutationHooks {
  context(run: RunView, signal: AbortSignal, toolCallId?: string): ToolContext;
  validateInspection(inspection: ToolInspection, decision: ToolPolicyDecision): Error | null;
  failedResult(error: unknown): ToolResult;
  duplicateResult(): ToolResult;
  rejectProposed(run: RunView, inspection: ToolInspection, result: ToolResult): Promise<StateCommitResult>;
  rejectReady(run: RunView, failure: GovernedMutationFailure): Promise<StateCommitResult>;
  begin(run: RunView, approvalId: string, inspection: ToolInspection): Promise<StateCommitResult>;
  settle(run: RunView, result: ToolResult): Promise<StateCommitResult>;
  onCommit(result: StateCommitResult, phase: GovernedMutationCommitPhase): void | Promise<void>;
  recoverySafePoint(run: RunView): Promise<void>;
  delegationId?: string;
  leaseReconciliationExtra?: JsonValue;
  unknownQuarantineReason: string;
  commitFailureQuarantineReason: string;
  quarantineEvidence(result: ToolResult | null, error?: unknown): JsonValue;
}

export interface GovernedMutationPrepareRequest extends GovernedMutationIdentity {
  run: RunView;
  inspection: ToolInspection;
  signal: AbortSignal;
  autoApprove: boolean;
  hooks: GovernedMutationHooks;
}

export type GovernedMutationPrepareResult =
  | { status: 'rejected'; run: RunView; inspection: ToolInspection }
  | { status: 'waiting_approval'; run: RunView; inspection: ToolInspection; approvalId: string }
  | { status: 'ready'; run: RunView; inspection: ToolInspection; approvalId: string };

export interface GovernedMutationExecuteRequest extends GovernedMutationIdentity {
  run: RunView;
  inspection: ToolInspection;
  approvalId: string;
  signal: AbortSignal;
  hooks: GovernedMutationHooks;
}

export interface GovernedMutationExecuteResult {
  status: 'rejected' | 'settled';
  run: RunView;
  inspection: ToolInspection;
  result?: ToolResult;
  commit: StateCommitResult;
}

type GovernedMutationCommitPort = Pick<
  StateCommitPort,
  'refreshProposedTool' | 'requestToolApproval' | 'resolveToolApproval' | 'commit' | 'evaluateToolLoopGuard'
>;

export class GovernedMutationExecutor {
  constructor(
    private readonly runs: Pick<RunExecutionReaderPort, 'confirmedMutation'>,
    private readonly stateCommit: GovernedMutationCommitPort,
    private readonly toolCalls: ToolCallRunner,
    private readonly now: () => number,
  ) {}

  async prepare(request: GovernedMutationPrepareRequest): Promise<GovernedMutationPrepareResult> {
    let activeRun = request.run;
    let inspection: ToolInspection;
    let decision: ToolPolicyDecision;
    try {
      ({ inspection, policyDecision: decision } = await this.toolCalls.refreshMutationInspection(
        request.hooks.context(activeRun, request.signal),
        request.inspection,
      ));
    } catch (error) {
      const result = request.hooks.failedResult(error);
      const rejected = await request.hooks.rejectProposed(activeRun, request.inspection, result);
      return { status: 'rejected', run: rejected.run, inspection: request.inspection };
    }

    const validationError = request.hooks.validateInspection(inspection, decision);
    if (validationError) {
      const result = request.hooks.failedResult(validationError);
      const rejected = await request.hooks.rejectProposed(activeRun, inspection, result);
      return { status: 'rejected', run: rejected.run, inspection };
    }

    if (inspectionChanged(request.inspection, inspection)) {
      const refreshed = await this.stateCommit.refreshProposedTool({
        scope: request.scope,
        runId: request.runId,
        toolStepId: request.toolStepId,
        toolCallId: request.toolCallId,
        expectedRunVersion: activeRun.version,
        inspection,
        now: this.now(),
      });
      activeRun = refreshed.run;
      await request.hooks.onCommit(refreshed, 'inspection_refreshed');
    }

    const duplicate = await this.runs.confirmedMutation(request.scope, request.runId, inspection.operationHash);
    if (duplicate && duplicate.toolCallId !== request.toolCallId) {
      const rejected = await request.hooks.rejectProposed(activeRun, inspection, request.hooks.duplicateResult());
      return { status: 'rejected', run: rejected.run, inspection };
    }

    const approvalId = randomUUID();
    const now = this.now();
    const requested = await this.stateCommit.requestToolApproval({
      scope: request.scope,
      runId: request.runId,
      runtimeId: request.runtimeId,
      toolStepId: request.toolStepId,
      toolCallId: request.toolCallId,
      approvalId,
      expectedRunVersion: activeRun.version,
      inspection,
      expiresAt: now + TOOL_APPROVAL_TTL_SECONDS,
      now,
    });
    activeRun = requested.run;
    await request.hooks.onCommit(requested, 'approval_requested');
    if (!request.autoApprove) return { status: 'waiting_approval', run: activeRun, inspection, approvalId };

    const expectedApprovalVersion = 1;
    const resolved = await this.stateCommit.resolveToolApproval({
      scope: request.scope,
      runId: request.runId,
      approvalId,
      decision: 'approved',
      operationHash: inspection.operationHash,
      expectedApprovalVersion,
      expectedRunVersion: activeRun.version,
      expectedPolicyRevision: inspection.policyRevision,
      expectedInputRevision: inspection.inputRevision,
      decidedByUserId: request.scope.userId,
      resolutionSource: 'full_access',
      idempotencyKey: randomUUID(),
      requestHash: requestHash(1, {
        approvalId,
        runId: request.runId,
        decision: 'approved',
        operationHash: inspection.operationHash,
        expectedVersion: expectedApprovalVersion,
      }),
      now: this.now(),
    });
    await request.hooks.onCommit(resolved, 'approval_resolved');
    return { status: 'ready', run: resolved.run, inspection, approvalId };
  }

  async execute(request: GovernedMutationExecuteRequest): Promise<GovernedMutationExecuteResult> {
    const context = request.hooks.context(request.run, request.signal);
    let inspection: ToolInspection;
    let decision: ToolPolicyDecision;
    try {
      ({ inspection, policyDecision: decision } = await this.toolCalls.refreshMutationInspection(
        context,
        request.inspection,
      ));
    } catch (error) {
      return this.rejectReady(request, {
        phase: 'reinspect',
        error,
        errorCode: executionErrorCode(error, 'MODEL_EXECUTION_FAILED'),
        inspection: request.inspection,
        previousInspection: request.inspection,
      });
    }

    const validationError = request.hooks.validateInspection(inspection, decision);
    if (
      validationError ||
      inspection.operationHash !== request.inspection.operationHash ||
      inspection.inputRevision !== request.inspection.inputRevision ||
      inspection.policyRevision !== request.inspection.policyRevision
    ) {
      const error = validationError ?? new Error('APPROVAL_STALE');
      return this.rejectReady(request, {
        phase: 'approval_refresh',
        error,
        errorCode: validationError ? executionErrorCode(error, 'APPROVAL_STALE') : 'APPROVAL_STALE',
        inspection,
        previousInspection: request.inspection,
      });
    }

    const duplicate = await this.runs.confirmedMutation(request.scope, request.runId, inspection.operationHash);
    if (duplicate && duplicate.toolCallId !== request.toolCallId) {
      return this.rejectReady(request, {
        phase: 'duplicate_guard',
        error: new Error('MUTATION_ALREADY_CONFIRMED'),
        errorCode: 'MUTATION_ALREADY_CONFIRMED',
        inspection,
        previousInspection: request.inspection,
        duplicate,
      });
    }

    const leaseTtlSeconds = toolLeaseTtlSeconds(request.run.budget.toolTimeoutSeconds);
    let lease: Awaited<ReturnType<ToolCallRunner['acquireMutation']>>;
    try {
      lease = await this.toolCalls.acquireMutation({
        runtimeId: request.runtimeId,
        operationId: request.toolCallId,
        resourceKeys: inspection.resourceKeys,
        ttlSeconds: leaseTtlSeconds,
        signal: request.signal,
        deadlineAt: context.deadlineAt,
      });
    } catch (error) {
      return this.rejectReady(request, {
        phase: 'lease_acquire',
        error,
        errorCode: executionErrorCode(error, 'LEASE_CONFLICT'),
        inspection,
        previousInspection: request.inspection,
      });
    }

    try {
      const begun = await request.hooks.begin(request.run, request.approvalId, inspection);
      await request.hooks.onCommit(begun, 'begun');
      const result = await this.toolCalls.executeMutation(
        lease,
        request.hooks.context(begun.run, lease.signal, request.toolCallId),
        inspection,
      );

      if (result.outcome !== 'confirmed') {
        await this.toolCalls
          .quarantineMutation(lease, request.hooks.unknownQuarantineReason, request.hooks.quarantineEvidence(result))
          .catch((error) =>
            logger.error(
              {
                err: error,
                errorCode: executionErrorCode(error, 'LEASE_QUARANTINE_FAILED'),
                runId: request.runId,
                runtimeId: request.runtimeId,
                toolCallId: request.toolCallId,
                toolName: inspection.toolName,
              },
              'Agent governed mutation quarantine failed after unknown outcome',
            ),
          );
      }

      let settled: StateCommitResult;
      try {
        settled = await request.hooks.settle(begun.run, result);
      } catch (error) {
        await this.toolCalls
          .quarantineMutation(
            lease,
            request.hooks.commitFailureQuarantineReason,
            request.hooks.quarantineEvidence(result, error),
          )
          .catch((quarantineError) =>
            logger.error(
              {
                err: quarantineError,
                errorCode: executionErrorCode(quarantineError, 'LEASE_QUARANTINE_FAILED'),
                originalErrorCode: executionErrorCode(error, 'STATE_COMMIT_FAILED'),
                runId: request.runId,
                runtimeId: request.runtimeId,
                toolCallId: request.toolCallId,
                toolName: inspection.toolName,
              },
              'Agent governed mutation quarantine failed after durable settle failure',
            ),
          );
        logger.error(
          {
            err: error,
            errorCode: executionErrorCode(error, 'STATE_COMMIT_FAILED'),
            runId: request.runId,
            runtimeId: request.runtimeId,
            toolCallId: request.toolCallId,
            toolName: inspection.toolName,
            mutationOutcome: result.outcome,
          },
          'Agent mutation result state commit failed',
        );
        throw error;
      }
      await request.hooks.onCommit(settled, 'settled');

      let finalized = settled;
      if (result.outcome === 'confirmed') {
        const leaseFinalization = await this.toolCalls.confirmMutation(lease);
        if (!leaseFinalization.ok) {
          const extra = request.hooks.leaseReconciliationExtra;
          finalized = await this.stateCommit.commit({
            scope: request.scope,
            runId: settled.run.id,
            expectedRunVersion: settled.run.version,
            events: [
              {
                type: 'run.reconciliation_required',
                payload: {
                  kind: 'lease_finalization',
                  mutationOutcome: 'confirmed',
                  toolCallId: leaseFinalization.toolCallId,
                  resourceKeys: leaseFinalization.resourceKeys,
                  reason: leaseFinalization.reason,
                  errorCode: leaseFinalization.errorCode,
                  ...(extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {}),
                },
              },
            ],
            runPatch: { needsReconciliation: true },
            now: this.now(),
          });
          await request.hooks.onCommit(finalized, 'lease_reconciliation');
        }
      }

      if (finalized.run.status === 'running' && !finalized.run.needsReconciliation) {
        const guarded = await this.stateCommit.evaluateToolLoopGuard({
          scope: request.scope,
          runId: finalized.run.id,
          runtimeId: request.runtimeId,
          ...(request.hooks.delegationId === undefined ? {} : { delegationId: request.hooks.delegationId }),
          expectedRunVersion: finalized.run.version,
          observations: [
            {
              toolName: inspection.toolName,
              risk: inspection.risk,
              operationHash: inspection.operationHash,
              result,
            },
          ],
          now: this.now(),
        });
        if (guarded.run.version !== finalized.run.version) {
          await request.hooks.onCommit(guarded, 'loop_guard');
        }
        finalized = guarded;
      }

      if (result.outcome === 'confirmed' && finalized.run.status === 'running' && !finalized.run.needsReconciliation) {
        await request.hooks.recoverySafePoint(finalized.run);
      }
      return { status: 'settled', run: finalized.run, inspection, result, commit: finalized };
    } finally {
      await this.toolCalls.cleanupMutation(lease);
    }
  }

  private async rejectReady(
    request: GovernedMutationExecuteRequest,
    failure: GovernedMutationFailure,
  ): Promise<GovernedMutationExecuteResult> {
    const rejected = await request.hooks.rejectReady(request.run, failure);
    return {
      status: 'rejected',
      run: rejected.run,
      inspection: failure.inspection,
      commit: rejected,
    };
  }
}
