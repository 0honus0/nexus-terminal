import { logger } from '../../../../shared/logging/logger';
import type { JsonValue, Scope } from '../../agent.types';
import type { RunExecutionMode } from '../runs/run.types';
import type { CatalogToolSchema } from '../../capabilities/tool-catalog';
import type { ToolPolicyDecision } from '../../capabilities/policy.service';
import { PolicyService } from '../../capabilities/policy.service';
import { ToolCatalog } from '../../capabilities/tool-catalog';
import { ToolExecutor } from '../../capabilities/tool-executor';
import { modelFacingToolSchemas, resolveDeferredToolProposal } from '../../capabilities/tool-model-surface';
import type {
  ToolAvailabilityContext,
  ToolContext,
  ToolInspection,
  ToolProposal,
  ToolResult,
} from '../../capabilities/tool.types';
import {
  executionErrorCode,
  executionErrorDetail,
  failedToolResult as buildFailedToolResult,
} from './execution-errors';
import { LeaseCoordinator, type LeaseRenewal } from './lease-coordinator';
import type {
  MutationLeaseFinalizationResult,
  MutationLeaseGuardHandle,
  MutationLeaseGuardPort,
} from './mutation-lease-guard.port';

export interface InspectedToolCall {
  inspection: ToolInspection;
  policyDecision: ToolPolicyDecision;
}

export interface ResolvedInspectedToolCall extends InspectedToolCall {
  proposal: ToolProposal;
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
  const detail = executionErrorDetail(error, code);
  return {
    ok: false,
    summary: `Remote mutation outcome could not be confirmed: ${detail}${detail === code ? '' : ` [${code}]`}`,
    data: { error: { code, message: detail } },
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

  schemas(
    scope: Scope,
    availability?: ToolAvailabilityContext,
    executionMode: RunExecutionMode = 'execute',
  ): CatalogToolSchema[] {
    return modelFacingToolSchemas(this.catalog, scope, availability, executionMode);
  }

  parallelSafe(scope: Scope, toolName: string, availability?: ToolAvailabilityContext): boolean {
    try {
      const tool = this.catalog.require(toolName, scope);
      if (availability && tool.isAvailable && !tool.isAvailable(availability)) return false;
      return tool.descriptor.parallelSafe === true;
    } catch {
      return false;
    }
  }

  async inspect(
    context: ToolContext,
    proposal: ToolProposal,
    executionMode: RunExecutionMode = 'execute',
  ): Promise<ResolvedInspectedToolCall> {
    try {
      const resolvedProposal = resolveDeferredToolProposal(this.catalog, context, proposal);
      if (executionMode === 'plan') {
        const descriptor = this.catalog.require(resolvedProposal.name, context).descriptor;
        if (descriptor.riskClass !== 'read' && descriptor.riskClass !== 'control') {
          throw new Error('PLAN_MODE_TOOL_FORBIDDEN');
        }
      }
      const inspection = await this.executor.inspect(context, resolvedProposal);
      const policyDecision = this.policy.decide(inspection, inspection.policyRevision);
      logger.debug(
        {
          userId: context.userId,
          appId: context.appId,
          runId: context.runId,
          toolCallId: context.toolCallId ?? null,
          toolName: inspection.toolName,
          executionMode,
          risk: inspection.risk,
          mutation: inspection.mutation,
          policyAction: policyDecision.action,
          policyRevision: inspection.policyRevision,
          resourceCount: inspection.resourceKeys.length,
          inputRevision: inspection.inputRevision,
        },
        'Agent tool proposal inspected',
      );
      return { inspection, policyDecision, proposal: resolvedProposal };
    } catch (error) {
      logger.warn(
        {
          err: error,
          errorCode: executionErrorCode(error, 'MODEL_TOOL_CALL_INVALID'),
          userId: context.userId,
          appId: context.appId,
          runId: context.runId,
          toolCallId: context.toolCallId ?? null,
          proposedToolName: proposal.name,
          executionMode,
        },
        'Agent tool proposal inspection failed',
      );
      throw error;
    }
  }

  decision(inspection: ToolInspection): ToolPolicyDecision {
    return this.policy.decide(inspection, inspection.policyRevision);
  }

  async refreshMutationInspection(context: ToolContext, previous: ToolInspection): Promise<InspectedToolCall> {
    if (!previous.mutation) throw new Error('TOOL_POLICY_INVALID');
    const inspection = await this.executor.refreshInspection(context, previous);
    return { inspection, policyDecision: this.policy.decide(inspection, inspection.policyRevision) };
  }

  async refreshReadInspection(context: ToolContext, previous: ToolInspection): Promise<InspectedToolCall> {
    if (previous.mutation || (previous.risk !== 'read' && previous.risk !== 'control')) {
      throw new Error('TOOL_POLICY_INVALID');
    }
    const inspection = await this.executor.refreshInspection(context, previous);
    return { inspection, policyDecision: this.policy.decide(inspection, inspection.policyRevision) };
  }

  failedProposal(error: unknown): ToolResult {
    return buildFailedToolResult(error, {
      fallbackCode: 'MODEL_TOOL_CALL_INVALID',
      summaryPrefix: 'Tool call rejected before execution',
      verificationSummary: 'The tool call was not executed.',
    });
  }

  async acquireRead(context: ToolContext, inspection: ToolInspection, ttlSeconds: number): Promise<ReadToolLease> {
    const owner = { type: 'agent' as const, id: context.agentRuntimeId };
    try {
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
    } catch (error) {
      logger.warn(
        {
          err: error,
          errorCode: executionErrorCode(error, 'LEASE_CONFLICT'),
          userId: context.userId,
          appId: context.appId,
          runId: context.runId,
          toolCallId: context.toolCallId ?? null,
          toolName: inspection.toolName,
          resourceCount: inspection.resourceKeys.length,
        },
        'Agent read tool lease acquisition failed',
      );
      throw error;
    }
  }

  async executeRead(lease: ReadToolLease, context: ToolContext, inspection: ToolInspection): Promise<ToolResult> {
    let result: ToolResult;
    try {
      result = await this.executor.execute({ ...context, signal: lease.signal }, inspection);
    } catch (error) {
      logger.warn(
        {
          err: error,
          errorCode: executionErrorCode(error, 'MODEL_EXECUTION_FAILED'),
          userId: context.userId,
          appId: context.appId,
          runId: context.runId,
          toolCallId: context.toolCallId ?? null,
          toolName: inspection.toolName,
        },
        'Agent read/control tool execution failed',
      );
      result = failedReadResult(error);
    }
    const renewalError = await lease.renewal.stop();
    if (renewalError) {
      logger.warn(
        {
          err: renewalError,
          errorCode: executionErrorCode(renewalError, 'LEASE_LOST'),
          userId: context.userId,
          appId: context.appId,
          runId: context.runId,
          toolCallId: context.toolCallId ?? null,
          toolName: inspection.toolName,
        },
        'Agent read tool lease renewal failed',
      );
      return failedReadResult(renewalError);
    }
    return result;
  }

  failedRead(error: unknown): ToolResult {
    return failedReadResult(error);
  }

  async releaseRead(lease: ReadToolLease): Promise<void> {
    await lease.renewal
      .stop()
      .catch((error) =>
        logger.warn({ err: error, leaseCount: lease.leaseIds.length }, 'Agent read lease renewal cleanup failed'),
      );
    await this.leaseCoordinator
      .release(lease.leaseIds, lease.owner)
      .catch((error) =>
        logger.warn({ err: error, leaseCount: lease.leaseIds.length }, 'Agent read lease release failed'),
      );
  }

  acquireMutation(request: {
    runtimeId: string;
    operationId: string;
    resourceKeys: readonly string[];
    ttlSeconds: number;
    signal: AbortSignal;
    deadlineAt: number;
  }): Promise<MutationLeaseGuardHandle> {
    return this.mutationLeases.acquire(request).catch((error) => {
      logger.warn(
        {
          err: error,
          errorCode: executionErrorCode(error, 'LEASE_CONFLICT'),
          runtimeId: request.runtimeId,
          operationId: request.operationId,
          resourceCount: request.resourceKeys.length,
        },
        'Agent mutation lease acquisition failed',
      );
      throw error;
    });
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
      logger.warn(
        {
          err: error,
          errorCode: executionErrorCode(error, 'MODEL_EXECUTION_FAILED'),
          userId: context.userId,
          appId: context.appId,
          runId: context.runId,
          toolCallId: context.toolCallId ?? null,
          toolName: inspection.toolName,
          resourceCount: inspection.resourceKeys.length,
        },
        'Agent mutation tool execution outcome unknown',
      );
      result = unknownMutationResult(error);
    }
    const renewalError = await lease.stopRenewal();
    if (renewalError) {
      logger.warn(
        {
          err: renewalError,
          errorCode: executionErrorCode(renewalError, 'LEASE_LOST'),
          userId: context.userId,
          appId: context.appId,
          runId: context.runId,
          toolCallId: context.toolCallId ?? null,
          toolName: inspection.toolName,
        },
        'Agent mutation lease renewal failed after execution',
      );
      result = unknownMutationResult(renewalError);
    }
    return result;
  }

  confirmMutation(lease: MutationLeaseGuardHandle): Promise<MutationLeaseFinalizationResult> {
    return lease.confirm();
  }

  quarantineMutation(lease: MutationLeaseGuardHandle, reason: string, evidence: JsonValue): Promise<void> {
    return lease.quarantine(reason, evidence);
  }

  async cleanupMutation(lease: MutationLeaseGuardHandle): Promise<void> {
    await lease
      .stopRenewal()
      .catch((error) => logger.warn({ err: error }, 'Agent mutation lease renewal cleanup failed'));
    await lease
      .releaseIfInactive()
      .catch((error) => logger.warn({ err: error }, 'Agent inactive mutation lease release failed'));
  }
}
