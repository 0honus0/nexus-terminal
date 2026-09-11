import type { JsonValue, Scope } from '../../agent.types';
import type { CatalogToolSchema } from '../../capabilities/tool-catalog';
import type { ToolPolicyDecision } from '../../capabilities/policy.service';
import { PolicyService } from '../../capabilities/policy.service';
import { ToolCatalog } from '../../capabilities/tool-catalog';
import { ToolExecutor } from '../../capabilities/tool-executor';
import type { ToolContext, ToolInspection, ToolProposal, ToolResult } from '../../capabilities/tool.types';
import { failedToolResult as buildFailedToolResult, executionErrorCode } from './execution-errors';
import { LeaseCoordinator, type LeaseRenewal } from './lease-coordinator';
import type { MutationLeaseGuardHandle, MutationLeaseGuardPort } from './mutation-lease-guard.port';

export interface InspectedToolCall {
  inspection: ToolInspection;
  policyDecision: ToolPolicyDecision;
}

export interface ReadToolLease {
  signal: AbortSignal;
  renewal: LeaseRenewal;
  leaseIds: string[];
  owner: { type: 'agent'; id: string };
}

const failedReadResult = (error: unknown): ToolResult =>
  buildFailedToolResult(error, {
    fallbackCode: 'MODEL_EXECUTION_FAILED',
    summaryPrefix: 'Read-only tool failed',
    verificationSummary: 'The read-only tool did not return a successful result.',
  });

const unknownMutationResult = (error: unknown): ToolResult => {
  const code = executionErrorCode(error, 'MODEL_EXECUTION_FAILED');
  return {
    ok: false,
    summary: `Remote mutation outcome could not be confirmed: ${code}`,
    artifactRefs: [],
    truncated: false,
    outcome: 'unknown',
    errorCode: code,
    verification: {
      status: 'failed',
      summary: 'The transport did not provide enough evidence to prove whether the mutation completed.',
      evidenceRefs: [],
    },
  };
};

export class ToolCallRunner {
  constructor(
    private readonly catalog: ToolCatalog,
    private readonly executor: ToolExecutor,
    private readonly policy: PolicyService,
    private readonly leaseCoordinator: LeaseCoordinator,
    private readonly mutationLeases: MutationLeaseGuardPort,
  ) {}

  schemas(scope: Scope): CatalogToolSchema[] {
    return this.catalog.schemas(scope);
  }

  async inspect(context: ToolContext, proposal: ToolProposal): Promise<InspectedToolCall> {
    const inspection = await this.executor.inspect(context, proposal);
    return { inspection, policyDecision: this.policy.decide(inspection, inspection.policyRevision) };
  }

  async refreshApprovedMutation(context: ToolContext, previous: ToolInspection): Promise<InspectedToolCall> {
    const inspection = await this.executor.refreshInspection(context, previous);
    return { inspection, policyDecision: this.policy.decide(inspection, inspection.policyRevision) };
  }

  async acquireRead(context: ToolContext, inspection: ToolInspection, ttlSeconds: number): Promise<ReadToolLease> {
    const owner = { type: 'agent' as const, id: context.agentRuntimeId };
    const leases = await this.leaseCoordinator.acquireWithRetry(
      owner,
      inspection.resourceKeys,
      'read',
      ttlSeconds,
      context.signal,
      context.deadlineAt,
    );
    const leaseIds = leases.map((lease) => lease.id);
    const renewal = this.leaseCoordinator.startRenewal(leaseIds, owner, ttlSeconds, context.signal);
    return { signal: renewal.signal, renewal, leaseIds, owner };
  }

  async executeRead(lease: ReadToolLease, context: ToolContext, inspection: ToolInspection): Promise<ToolResult> {
    let result: ToolResult;
    try {
      result = await this.executor.execute({ ...context, signal: lease.signal }, inspection);
    } catch (error) {
      result = failedReadResult(error);
    }
    const renewalError = await lease.renewal.stop();
    return renewalError ? failedReadResult(renewalError) : result;
  }

  async releaseRead(lease: ReadToolLease): Promise<void> {
    await lease.renewal.stop().catch(() => undefined);
    await this.leaseCoordinator.release(lease.leaseIds, lease.owner).catch(() => undefined);
  }

  acquireMutation(request: {
    runtimeId: string;
    operationId: string;
    resourceKeys: readonly string[];
    ttlSeconds: number;
    signal: AbortSignal;
    deadlineAt: number;
  }): Promise<MutationLeaseGuardHandle> {
    return this.mutationLeases.acquire(request);
  }

  async executeMutation(
    lease: MutationLeaseGuardHandle,
    context: ToolContext,
    inspection: ToolInspection,
  ): Promise<ToolResult> {
    await lease.activate();
    let result: ToolResult;
    try {
      result = await this.executor.executeMutation({ ...context, signal: lease.signal }, inspection);
    } catch (error) {
      result = unknownMutationResult(error);
    }
    const renewalError = await lease.stopRenewal();
    if (renewalError) result = unknownMutationResult(renewalError);
    return result;
  }

  confirmMutation(lease: MutationLeaseGuardHandle): Promise<void> {
    return lease.confirm();
  }

  quarantineMutation(lease: MutationLeaseGuardHandle, reason: string, evidence: JsonValue): Promise<void> {
    return lease.quarantine(reason, evidence);
  }

  async cleanupMutation(lease: MutationLeaseGuardHandle): Promise<void> {
    await lease.stopRenewal().catch(() => undefined);
    await lease.releaseIfInactive().catch(() => undefined);
  }
}
