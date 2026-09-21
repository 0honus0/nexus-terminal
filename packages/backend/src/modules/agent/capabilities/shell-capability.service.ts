import type { JsonValue } from '../agent.types';
import type { CryptoHashPort } from '../crypto-hash.port';
import { hashOperation } from '../operation-hash';
import type { WorkspaceJobView } from '../workspace-runtime/workspace-runtime-gateway.port';
import type { WorkspaceShellTargetPort } from '../workspace-runtime/workspace-shell-target.port';
import type { SshShellExecutionResult, SshShellTargetPort } from './ssh-shell-target.port';
import type { AgentTargetResolver, ResolvedAgentTarget } from './target-resolver';
import type { AgentTargetSelector, ToolTargetFingerprint } from './tool-target.types';
import type { ToolContext, ToolPrecondition } from './tool.types';

export type UnifiedShellCommand = { kind: 'argv'; argv: string[] } | { kind: 'shell'; text: string };
export type UnifiedShellMode = 'foreground' | 'background';

export interface UnifiedShellExecutionRequest {
  command: UnifiedShellCommand;
  cwd?: string;
  timeoutSeconds: number;
  mode: UnifiedShellMode;
  operationHash: string;
}

export interface UnifiedShellExecutionView {
  target: AgentTargetSelector;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';
  job?: WorkspaceJobView;
  result?: SshShellExecutionResult & { timedOut: boolean };
  error?: string | null;
}

export interface ResolvedShellJob {
  target: ResolvedAgentTarget;
  job: WorkspaceJobView;
}

export class ShellCapabilityService {
  constructor(
    private readonly targets: AgentTargetResolver,
    private readonly workspaceShell: WorkspaceShellTargetPort,
    private readonly sshShell: SshShellTargetPort,
    private readonly cryptoHash: CryptoHashPort,
  ) {}

  resolve(context: ToolContext, selector: AgentTargetSelector): Promise<ResolvedAgentTarget> {
    return this.targets.resolve(context, selector);
  }

  bindInspectionTarget(fingerprint: ToolTargetFingerprint): ResolvedAgentTarget {
    if (fingerprint.kind === 'workspace') {
      if (
        fingerprint.target !== 'workspace' ||
        fingerprint.workspaceId !== fingerprint.id ||
        fingerprint.generation === undefined
      ) {
        throw new Error('TOOL_STATE_CONFLICT');
      }
      return {
        selector: { target: 'workspace', id: fingerprint.id },
        fingerprint,
        resourceKeys: [`workspace:${fingerprint.id}:${fingerprint.generation}`],
        preconditions: [],
        workspaceGeneration: fingerprint.generation,
      };
    }
    if (fingerprint.kind === 'ssh') {
      if (
        fingerprint.target !== 'ssh' ||
        fingerprint.connectionId === undefined ||
        String(fingerprint.connectionId) !== fingerprint.id
      ) {
        throw new Error('TOOL_STATE_CONFLICT');
      }
      return {
        selector: { target: 'ssh', id: fingerprint.id },
        fingerprint,
        resourceKeys: [`connection:${fingerprint.connectionId}`],
        preconditions: [],
        connectionId: fingerprint.connectionId,
      };
    }
    throw new Error('TOOL_STATE_CONFLICT');
  }

  async execute(
    context: ToolContext,
    target: ResolvedAgentTarget,
    request: UnifiedShellExecutionRequest,
  ): Promise<UnifiedShellExecutionView> {
    if (target.selector.target === 'workspace') {
      if (request.command.kind !== 'argv') throw new Error('TOOL_ARGUMENTS_INVALID');
      const generation = target.workspaceGeneration;
      if (generation === undefined) throw new Error('TOOL_STATE_CONFLICT');
      const call = {
        operationHash: request.operationHash,
        argv: request.command.argv,
        cwd: request.cwd ?? '/workspace/work',
        maxBytes: Math.max(1, Math.min(512 * 1024, Math.floor(context.maxOutputBytes / 2))),
        timeoutMs: request.timeoutSeconds * 1000,
      };
      const job = await this.workspaceShell.execute(context, target.selector.id, generation, call, request.mode);
      return { target: target.selector, status: job.status, job, error: job.error };
    }

    if (request.command.kind !== 'shell' || request.mode !== 'foreground' || request.cwd !== undefined) {
      throw new Error('TOOL_ARGUMENTS_INVALID');
    }
    const connectionId = target.connectionId;
    if (connectionId === undefined) throw new Error('TOOL_STATE_CONFLICT');
    const result = await this.sshShell.execute(
      context,
      connectionId,
      request.command.text,
      request.timeoutSeconds,
      target.fingerprint.configurationHash,
    );
    return {
      target: target.selector,
      status: result.exitCode === 0 ? 'succeeded' : 'failed',
      result: { ...result, timedOut: false },
      error: null,
    };
  }

  async resolveJob(context: ToolContext, selector: AgentTargetSelector, jobId: string): Promise<ResolvedShellJob> {
    if (selector.target !== 'workspace') throw new Error('TOOL_ARGUMENTS_INVALID');
    const job = await this.workspaceShell.resolveOwnedJob(context, selector.id, jobId);
    const fingerprint: ToolTargetFingerprint = {
      kind: 'workspace',
      target: 'workspace',
      id: job.workspaceId,
      workspaceId: job.workspaceId,
      generation: job.generation,
      targetIdentity: `workspace:${job.workspaceId}:${job.generation}:job:${job.jobId}`,
      endpoint: `workspace:${job.workspaceId}`,
      loginUser: 'runner:65532',
      configurationHash: hashOperation(
        { schemaVersion: 2, workspaceId: job.workspaceId, generation: job.generation, jobId: job.jobId } as JsonValue,
        this.cryptoHash,
      ),
    };
    const preconditions: ToolPrecondition[] = [
      {
        kind: 'metadata',
        key: job.jobId,
        observedValue: { workspaceId: job.workspaceId, generation: job.generation, status: job.status },
      },
    ];
    return {
      target: {
        selector: { target: 'workspace', id: job.workspaceId },
        fingerprint,
        resourceKeys: [`workspace-job:${job.jobId}`],
        preconditions,
        workspaceGeneration: job.generation,
      },
      job,
    };
  }

  async controlJob(
    context: ToolContext,
    target: ResolvedAgentTarget,
    jobId: string,
    action: 'status' | 'wait' | 'cancel',
    waitSeconds?: number,
  ): Promise<WorkspaceJobView> {
    if (target.selector.target !== 'workspace' || target.workspaceGeneration === undefined) {
      throw new Error('TOOL_STATE_CONFLICT');
    }
    return this.workspaceShell.controlJob(
      context,
      target.selector.id,
      target.workspaceGeneration,
      jobId,
      action,
      waitSeconds,
    );
  }
}
