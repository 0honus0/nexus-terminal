import { randomUUID } from 'node:crypto';
import { logger } from '../../../../shared/logging/logger';
import type { ClockPort, Scope } from '../../agent.types';
import type { AcpPermissionRequest } from '../../ai/integrations.types';
import type { ToolContext, ToolInspection } from '../../capabilities/tool.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { canonicalize, hashOperation } from '../../operation-hash';
import type { AcpPermissionApprovalCommitPort } from '../runs/state-commit.port';
import { TOOL_APPROVAL_TTL_SECONDS } from './approval-policy';

export type AcpPermissionDecision = 'allow_once' | 'reject_once';

export interface AcpPermissionRequestPort {
  request(
    context: ToolContext,
    parentInspection: ToolInspection,
    request: AcpPermissionRequest,
  ): Promise<AcpPermissionDecision>;
}

export interface AcpPermissionResolutionHandle {
  finish(decision: AcpPermissionDecision): void;
  failClosed(): Promise<void>;
}

export interface AcpPermissionResolutionPort {
  take(approvalId: string): AcpPermissionResolutionHandle | null;
}

interface PendingPermission {
  runId: string;
  reserve(): boolean;
  finish(decision: AcpPermissionDecision): boolean;
  failClosed(): Promise<boolean>;
}

const boundedText = (value: string | null, maxChars = 256): string | null =>
  value === null ? null : value.slice(0, maxChars);

const boundedIdentifier = (value: string): string => {
  const normalized = value.trim();
  if (!normalized || normalized.includes('\0') || Buffer.byteLength(normalized, 'utf8') > 512) {
    throw new Error('ACP_PERMISSION_REQUEST_INVALID');
  }
  return normalized;
};

export class AcpPermissionBroker implements AcpPermissionRequestPort, AcpPermissionResolutionPort {
  private readonly pending = new Map<string, PendingPermission>();

  constructor(
    private readonly stateCommit: AcpPermissionApprovalCommitPort,
    private readonly cryptoHash: CryptoHashPort,
    private readonly clock: ClockPort,
    private readonly notifyChanged: (runId: string, approvalId: string) => void,
  ) {}

  take(approvalId: string): AcpPermissionResolutionHandle | null {
    const pending = this.pending.get(approvalId);
    if (!pending || !pending.reserve()) return null;
    let finished = false;
    return {
      finish: (decision) => {
        if (finished) return;
        finished = true;
        if (pending.finish(decision)) this.notifyChanged(pending.runId, approvalId);
      },
      failClosed: async () => {
        if (finished) return;
        finished = true;
        await pending.failClosed();
      },
    };
  }

  async request(
    context: ToolContext,
    parentInspection: ToolInspection,
    request: AcpPermissionRequest,
  ): Promise<AcpPermissionDecision> {
    if (!context.toolCallId) throw new Error('ACP_PERMISSION_PARENT_TOOL_MISSING');
    const sessionId = boundedIdentifier(request.sessionId);
    const innerToolCallId = boundedIdentifier(request.toolCallId);
    const now = this.clock.nowUnixSeconds();
    const expiresAt = Math.min(context.deadlineAt, now + TOOL_APPROVAL_TTL_SECONDS);
    if (expiresAt <= now) return 'reject_once';

    const rawInput = request.rawInput;
    const rawInputCanonical = canonicalize(rawInput);
    const rawInputBytes = Buffer.byteLength(rawInputCanonical, 'utf8');
    const rawInputSha256 = this.cryptoHash.sha256Utf8(rawInputCanonical);
    const approvalId = randomUUID();
    const inspection: ToolInspection = {
      toolName: 'acp_inner_permission',
      toolVersion: '1.0.0',
      normalizedArguments: {
        parentToolCallId: context.toolCallId,
        sessionId,
        acpToolCallId: innerToolCallId,
        title: boundedText(request.title),
        kind: boundedText(request.kind, 128),
        rawInputBytes,
        rawInputSha256,
      },
      target: { ...parentInspection.target },
      resourceKeys: [...parentInspection.resourceKeys],
      risk: 'mutate',
      mutation: true,
      operationHash: hashOperation(
        {
          schemaVersion: 1,
          parentOperationHash: parentInspection.operationHash,
          parentToolCallId: context.toolCallId,
          sessionId,
          acpToolCallId: innerToolCallId,
          title: boundedText(request.title),
          kind: boundedText(request.kind, 128),
          rawInputBytes,
          rawInputSha256,
          policyRevision: parentInspection.policyRevision,
          inputRevision: parentInspection.inputRevision,
        },
        this.cryptoHash,
      ),
      operationHashVersion: 1,
      preconditions: parentInspection.preconditions.map((item) => ({ ...item })),
      policyRevision: parentInspection.policyRevision,
      inputRevision: parentInspection.inputRevision,
    };

    await this.stateCommit.requestAcpPermissionApproval({
      scope: { userId: context.userId, appId: context.appId },
      runId: context.runId,
      runtimeId: context.agentRuntimeId,
      parentToolCallId: context.toolCallId,
      parentOperationHash: parentInspection.operationHash,
      approvalId,
      inspection,
      expiresAt,
      now,
    });
    if (context.signal.aborted) {
      await this.close(context, approvalId, context.runId, 'superseded').catch((error) =>
        logger.warn({ err: error, runId: context.runId, approvalId }, 'Agent ACP approval cleanup failed after abort'),
      );
      throw context.signal.reason ?? new Error('ABORTED');
    }

    return new Promise<AcpPermissionDecision>((resolve, reject) => {
      let settled = false;
      let reserved = false;
      let timer: NodeJS.Timeout | null = null;
      const settle = (): boolean => {
        if (settled) return false;
        settled = true;
        if (timer) clearTimeout(timer);
        context.signal.removeEventListener('abort', onAbort);
        this.pending.delete(approvalId);
        return true;
      };
      const reserve = (): boolean => {
        if (settled || reserved) return false;
        reserved = true;
        return true;
      };
      const finish = (decision: AcpPermissionDecision): boolean => {
        if (!settle()) return false;
        resolve(decision);
        return true;
      };
      const failClosed = async (): Promise<boolean> => {
        if (!settle()) return false;
        await this.close(context, approvalId, context.runId, 'superseded').catch((error) =>
          logger.warn(
            { err: error, runId: context.runId, approvalId },
            'Agent ACP approval fail-closed cleanup failed',
          ),
        );
        this.notifyChanged(context.runId, approvalId);
        resolve('reject_once');
        return true;
      };
      const onAbort = (): void => {
        if (!settle()) return;
        void this.close(context, approvalId, context.runId, 'superseded')
          .catch((error) =>
            logger.warn({ err: error, runId: context.runId, approvalId }, 'Agent ACP approval abort cleanup failed'),
          )
          .finally(() => {
            this.notifyChanged(context.runId, approvalId);
            reject(context.signal.reason ?? new Error('ABORTED'));
          });
      };
      const pending: PendingPermission = {
        runId: context.runId,
        reserve,
        finish,
        failClosed,
      };
      this.pending.set(approvalId, pending);
      timer = setTimeout(
        () => {
          if (!settle()) return;
          void this.close(context, approvalId, context.runId, 'expired')
            .catch((error) =>
              logger.warn({ err: error, runId: context.runId, approvalId }, 'Agent ACP approval expiry cleanup failed'),
            )
            .finally(() => {
              this.notifyChanged(context.runId, approvalId);
              resolve('reject_once');
            });
        },
        Math.max(1, expiresAt - now) * 1000,
      );
      timer.unref?.();
      context.signal.addEventListener('abort', onAbort, { once: true });
      if (context.signal.aborted) onAbort();
      this.notifyChanged(context.runId, approvalId);
    });
  }

  private close(scope: Scope, approvalId: string, runId: string, status: 'expired' | 'superseded'): Promise<unknown> {
    return this.stateCommit.closeAcpPermissionApproval({
      scope: { userId: scope.userId, appId: scope.appId },
      runId,
      approvalId,
      expectedApprovalVersion: 1,
      status,
      now: this.clock.nowUnixSeconds(),
    });
  }
}
