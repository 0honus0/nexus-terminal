import type { JsonValue } from '../agent.types';
import type { CryptoHashPort } from '../crypto-hash.port';
import { hashOperation } from '../operation-hash';
import type {
  WorkspaceJobView,
  WorkspaceRuntimeGatewayPort,
} from '../workspace-runtime/workspace-runtime-gateway.port';
import type { AgentWorkspaceRepositoryPort } from '../workspace-runtime/workspace-runtime.repository.port';
import type { MachineCapabilityPort, ShellMutationResult } from './machine.port';
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
  result?: ShellMutationResult & { timedOut: boolean };
  error?: string | null;
}

export interface ResolvedShellJob {
  target: ResolvedAgentTarget;
  job: WorkspaceJobView;
}

export class ShellCapabilityService {
  constructor(
    private readonly targets: AgentTargetResolver,
    private readonly workspaces: AgentWorkspaceRepositoryPort,
    private readonly gateway: WorkspaceRuntimeGatewayPort,
    private readonly machine: MachineCapabilityPort,
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
      const job =
        request.mode === 'background'
          ? await this.gateway.startJob({ workspaceId: target.selector.id, generation }, call, context.signal)
          : await this.gateway.invoke({ workspaceId: target.selector.id, generation }, call, context.signal);
      return { target: target.selector, status: job.status, job, error: job.error };
    }

    if (request.command.kind !== 'shell' || request.mode !== 'foreground' || request.cwd !== undefined) {
      throw new Error('TOOL_ARGUMENTS_INVALID');
    }
    const connectionId = target.connectionId;
    if (connectionId === undefined) throw new Error('TOOL_STATE_CONFLICT');
    const result = await this.machine.executeShell(
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
    const job = await this.gateway.queryJob(jobId, context.signal);
    if (job.workspaceId !== selector.id) throw new Error('RESOURCE_FORBIDDEN');
    const workspace = await this.workspaces.getWorkspace(context, job.workspaceId);
    if (!workspace) throw new Error('NOT_FOUND');
    if (workspace.runId !== context.runId || workspace.agentRuntimeId !== context.agentRuntimeId) {
      throw new Error('RESOURCE_FORBIDDEN');
    }
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
    const job =
      action === 'status'
        ? await this.gateway.queryJob(jobId, context.signal)
        : action === 'wait'
          ? await this.gateway.waitJob(jobId, (waitSeconds ?? 1) * 1000, context.signal)
          : await this.gateway.cancelJob(jobId, context.signal);
    if (job.workspaceId !== target.selector.id || job.generation !== target.workspaceGeneration) {
      throw new Error('RESOURCE_CHANGED');
    }
    return job;
  }
}
