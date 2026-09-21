import { randomUUID } from 'node:crypto';
import { logger } from '../../../../shared/logging/logger';
import type { ClockPort, JsonValue } from '../../agent.types';
import type { ToolResult } from '../../capabilities/tool.types';
import type { BackendSignal } from './agent-backend.port';
import { executionErrorCode, executionErrorDetail } from './execution-errors';
import {
  GovernedMutationExecutor,
  type GovernedMutationFailure,
  type GovernedMutationHooks,
} from './governed-mutation-executor';
import type { PendingRootTool, RunExecutionReaderPort } from '../runs/run.repository.port';
import type { RootExecutionCommitPort, StateCommitResult } from '../runs/state-commit.port';
import type { RunSnapshot, RunUsage, RunView } from '../runs/run.types';
import { rejectedRootToolResult, rootToolContext } from './root-tool-execution-common';
import { ToolCallRunner } from './tool-call-runner';

const usageWithToolStep = (base: RunUsage): RunUsage => ({ ...base, steps: base.steps + 1 });
const errorCode = (error: unknown): string => executionErrorCode(error, 'MODEL_EXECUTION_FAILED');

const mutationLeaseFailureReason = (error: unknown, code: string, resourceKeys: readonly string[]): string => {
  const resources = resourceKeys.length > 0 ? resourceKeys.join(', ') : 'target resource';
  if (code === 'RESOURCE_QUARANTINED') {
    return `Cannot mutate ${resources}: the resource is quarantined after an earlier mutation with an unresolved outcome. Verify the actual state and reconcile it before retrying. [${code}]`;
  }
  if (code === 'LEASE_CONFLICT') {
    return `Cannot mutate ${resources}: another active operation currently holds its write lease. Wait for that operation to finish or stop it before retrying. [${code}]`;
  }
  if (code === 'LEASE_LOST') {
    return `Cannot mutate ${resources}: the write lease was lost before execution could start safely. [${code}]`;
  }
  const detail = executionErrorDetail(error, code);
  return `Cannot acquire the write lease for ${resources}: ${detail}${detail === code ? '' : ` [${code}]`}`;
};

export class RootMutationExecutionAdapter {
  private readonly governedMutations: GovernedMutationExecutor;

  constructor(
    repository: RunExecutionReaderPort,
    private readonly stateCommit: RootExecutionCommitPort,
    private readonly toolCalls: ToolCallRunner,
    private readonly clock: ClockPort,
    private readonly recoverySafePoint: (run: RunView, reason: 'mutation_confirmed') => Promise<void>,
  ) {
    this.governedMutations = new GovernedMutationExecutor(repository, stateCommit, toolCalls, () =>
      this.clock.nowUnixSeconds(),
    );
  }

  async *supersedeForBudget(snapshot: RunSnapshot, pending: PendingRootTool): AsyncGenerator<BackendSignal, void> {
    if (pending.status !== 'ready' || !pending.approvalId) throw new Error('APPROVAL_STATE_INVALID');
    const superseded = await this.stateCommit.supersedeMutationTool({
      scope: { userId: snapshot.userId, appId: snapshot.appId },
      runId: snapshot.id,
      toolStepId: pending.stepId,
      toolCallId: pending.toolCallId,
      approvalId: pending.approvalId,
      expectedRunVersion: snapshot.version,
      reason: 'The Run step budget was exhausted before this approved mutation could execute.',
      errorCode: 'RUN_STEP_BUDGET_EXHAUSTED',
      details: { phase: 'budget', resourceKeys: pending.inspection.resourceKeys },
      now: this.clock.nowUnixSeconds(),
    });
    yield { type: 'durable', runId: snapshot.id, cursor: superseded.eventCursor };
  }

  async *prepare(
    snapshot: RunSnapshot,
    pending: PendingRootTool,
    signal: AbortSignal,
  ): AsyncGenerator<BackendSignal, boolean> {
    if (pending.status !== 'proposed' || !pending.inspection.mutation) throw new Error('TOOL_STATE_CONFLICT');
    const commits: StateCommitResult[] = [];
    const hooks = this.rootMutationHooks(snapshot, pending, commits, 'prepare');
    const prepared = await this.governedMutations.prepare({
      scope: { userId: snapshot.userId, appId: snapshot.appId },
      runId: snapshot.id,
      runtimeId: pending.runtimeId,
      toolStepId: pending.stepId,
      toolCallId: pending.toolCallId,
      run: snapshot,
      inspection: pending.inspection,
      signal,
      autoApprove: snapshot.definition.approvalMode === 'full_access',
      hooks,
    });
    for (const commit of commits) yield { type: 'durable', runId: snapshot.id, cursor: commit.eventCursor };
    if (prepared.status === 'waiting_approval') {
      yield { type: 'settled', run: prepared.run };
      return true;
    }
    if (prepared.status === 'rejected') {
      if (prepared.run.status === 'awaiting_input') yield { type: 'settled', run: prepared.run };
      return false;
    }
    logger.info(
      {
        runId: snapshot.id,
        toolCallId: pending.toolCallId,
        toolName: prepared.inspection.toolName,
        approvalId: prepared.approvalId,
      },
      'Agent batch mutation auto-approved by full access mode',
    );
    return false;
  }

  async *execute(snapshot: RunSnapshot, pending: PendingRootTool, signal: AbortSignal): AsyncIterable<BackendSignal> {
    if (pending.status !== 'ready' || !pending.approvalId || pending.approvalVersion === null) {
      throw new Error('APPROVAL_STATE_INVALID');
    }
    const commits: StateCommitResult[] = [];
    const hooks = this.rootMutationHooks(snapshot, pending, commits, 'execute');
    const executed = await this.governedMutations.execute({
      scope: { userId: snapshot.userId, appId: snapshot.appId },
      runId: snapshot.id,
      runtimeId: pending.runtimeId,
      toolStepId: pending.stepId,
      toolCallId: pending.toolCallId,
      run: snapshot,
      inspection: pending.inspection,
      approvalId: pending.approvalId,
      signal,
      hooks,
    });
    for (const commit of commits) yield { type: 'durable', runId: snapshot.id, cursor: commit.eventCursor };
    if (executed.status === 'settled') {
      yield { type: 'durable', runId: snapshot.id, cursor: executed.commit.eventCursor };
      if (executed.run.status === 'interrupted' || executed.run.status === 'awaiting_input') {
        yield { type: 'settled', run: executed.run };
      }
    }
  }

  private rootMutationHooks(
    snapshot: RunSnapshot,
    pending: PendingRootTool,
    commits: StateCommitResult[],
    mode: 'prepare' | 'execute',
  ): GovernedMutationHooks {
    const scope = { userId: snapshot.userId, appId: snapshot.appId };
    return {
      context: (run, signal, toolCallId) =>
        rootToolContext(
          run,
          pending.runtimeId,
          pending.stepId,
          signal,
          this.clock.nowUnixSeconds(),
          undefined,
          toolCallId,
        ),
      validateInspection: (inspection, decision) => {
        if (decision.action === 'requireApproval' && inspection.mutation) return null;
        return new Error(decision.action === 'deny' ? decision.reason : 'TOOL_POLICY_INVALID');
      },
      failedResult: (error) => this.toolCalls.failedProposal(error),
      duplicateResult: () =>
        rejectedRootToolResult(
          'MUTATION_ALREADY_CONFIRMED',
          'An identical mutation already completed successfully earlier in this Run. This duplicate proposal was not executed again.',
        ),
      rejectProposed: async (run, inspection, result) => {
        const rejected = await this.stateCommit.rejectProposedTool({
          scope,
          runId: run.id,
          toolStepId: pending.stepId,
          toolCallId: pending.toolCallId,
          expectedRunVersion: run.version,
          providerCallId: pending.providerCallId,
          result,
          now: this.clock.nowUnixSeconds(),
        });
        commits.push(rejected);
        if (rejected.run.status !== 'running') return rejected;
        const guarded = await this.stateCommit.evaluateToolLoopGuard({
          scope,
          runId: rejected.run.id,
          runtimeId: pending.runtimeId,
          expectedRunVersion: rejected.run.version,
          observations: [
            {
              toolName: inspection.toolName,
              risk: inspection.risk,
              operationHash: inspection.operationHash,
              result,
            },
          ],
          now: this.clock.nowUnixSeconds(),
        });
        if (guarded.run.version !== rejected.run.version) commits.push(guarded);
        return guarded;
      },
      rejectReady: async (run, failure) => {
        const rejection = this.rootReadyMutationFailure(failure);
        const superseded = await this.stateCommit.supersedeMutationTool({
          scope,
          runId: run.id,
          toolStepId: pending.stepId,
          toolCallId: pending.toolCallId,
          approvalId: pending.approvalId!,
          expectedRunVersion: run.version,
          reason: rejection.reason,
          errorCode: rejection.errorCode,
          details: rejection.details,
          now: this.clock.nowUnixSeconds(),
        });
        commits.push(superseded);
        return superseded;
      },
      begin: (run, approvalId, inspection) =>
        this.stateCommit.beginMutationTool({
          scope,
          runId: run.id,
          runtimeId: pending.runtimeId,
          toolStepId: pending.stepId,
          toolCallId: pending.toolCallId,
          approvalId,
          expectedRunVersion: run.version,
          operationHash: inspection.operationHash,
          expectedPolicyRevision: inspection.policyRevision,
          expectedInputRevision: inspection.inputRevision,
          now: this.clock.nowUnixSeconds(),
        }),
      settle: (run, result) =>
        this.stateCommit.settleMutationTool({
          scope,
          runId: run.id,
          runtimeId: pending.runtimeId,
          toolStepId: pending.stepId,
          toolCallId: pending.toolCallId,
          expectedRunVersion: run.version,
          toolResultEntryId: randomUUID(),
          providerCallId: pending.providerCallId,
          result,
          usage: usageWithToolStep(run.usage),
          needsReconciliation: result.outcome === 'unknown',
          now: this.clock.nowUnixSeconds(),
        }),
      onCommit: (commit, phase) => {
        if (mode === 'prepare' || phase === 'begun') commits.push(commit);
      },
      recoverySafePoint: (run) => this.recoverySafePoint(run, 'mutation_confirmed'),
      unknownQuarantineReason: 'MUTATION_OUTCOME_UNKNOWN',
      commitFailureQuarantineReason: 'STATE_COMMIT_FAILED_AFTER_MUTATION',
      quarantineEvidence: (result, error) => ({
        toolCallId: pending.toolCallId,
        errorCode: error ? errorCode(error) : (result?.errorCode ?? 'UNKNOWN'),
      }),
    };
  }

  private rootReadyMutationFailure(failure: GovernedMutationFailure): {
    reason: string;
    errorCode: string;
    details: JsonValue;
  } {
    if (failure.phase === 'reinspect') {
      const detail = executionErrorDetail(failure.error, failure.errorCode);
      return {
        reason: `Approved operation could not be re-inspected safely: ${detail}${detail === failure.errorCode ? '' : ` [${failure.errorCode}]`}`,
        errorCode: failure.errorCode,
        details: { phase: 'reinspect', resourceKeys: failure.previousInspection.resourceKeys },
      };
    }
    if (failure.phase === 'approval_refresh') {
      return {
        reason:
          'The target, preconditions, input, or policy changed after approval; the approved mutation was not executed.',
        errorCode: 'APPROVAL_STALE',
        details: {
          phase: 'approval_refresh',
          resourceKeys: failure.inspection.resourceKeys,
          targetChanged: failure.inspection.operationHash !== failure.previousInspection.operationHash,
          inputChanged: failure.inspection.inputRevision !== failure.previousInspection.inputRevision,
          policyChanged: failure.inspection.policyRevision !== failure.previousInspection.policyRevision,
        },
      };
    }
    if (failure.phase === 'duplicate_guard') {
      return {
        reason:
          'An identical mutation already completed successfully earlier in this Run. This duplicate proposal was not executed again.',
        errorCode: 'MUTATION_ALREADY_CONFIRMED',
        details: {
          phase: 'duplicate_guard',
          operationHash: failure.inspection.operationHash,
          previousToolCallId: failure.duplicate?.toolCallId ?? null,
          previousProviderCallId: failure.duplicate?.providerCallId ?? null,
          resourceKeys: failure.inspection.resourceKeys,
        },
      };
    }
    return {
      reason: mutationLeaseFailureReason(failure.error, failure.errorCode, failure.inspection.resourceKeys),
      errorCode: failure.errorCode,
      details: { phase: 'lease_acquire', resourceKeys: failure.inspection.resourceKeys },
    };
  }
}
