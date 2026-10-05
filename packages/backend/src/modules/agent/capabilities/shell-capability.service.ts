import type { WorkspaceJobView, WorkspaceJobCapacityView } from '@nexus-terminal/protocol/runner';
import type { JsonValue } from '../agent.types';
import type { CryptoHashPort } from '../crypto-hash.port';
import { hashOperation } from '../operation-hash';

import type { WorkspaceShellTargetPort } from '../workspace-runtime/workspace-shell-target.port';
import type { SshShellExecutionResult, SshShellTargetPort } from './ssh-shell-target.port';
import type { AgentSshSessionPort, SshJobView } from './ssh-session.port';
import type { AgentTargetResolver, ResolvedAgentTarget } from './target-resolver';
import type { AgentTargetSelector, ToolTargetFingerprint } from './tool-target.types';
import type { ToolContext, ToolPrecondition } from './tool.types';

export type UnifiedShellCommand = { kind: 'argv'; argv: string[] } | { kind: 'shell'; shellScript: string };
export type UnifiedShellMode = 'foreground' | 'background';

// SSH exec transports shell source, not a native argv vector. Quote every argument
// independently so shell operators, substitutions and whitespace remain literal.
const quoteShellArgument = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

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
  sshJob?: SshJobView;
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
    private readonly sshSessions?: AgentSshSessionPort,
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
      const generation = target.workspaceGeneration;
      if (generation === undefined) throw new Error('TOOL_STATE_CONFLICT');
      const call = {
        executionId: this.executionId(context, target),
        argv: request.command.kind === 'argv' ? request.command.argv : ['/bin/sh', '-c', request.command.shellScript],
        cwd: request.cwd ?? '/workspace/work',
        maxBytes: Math.max(1, Math.min(512 * 1024, Math.floor(context.maxOutputBytes / 2))),
        timeoutMs: request.timeoutSeconds * 1000,
      };
      const job = await this.workspaceShell.execute(context, target.selector.id, generation, call, request.mode);
      return { target: target.selector, status: job.status, job, error: job.error };
    }

    const source =
      request.command.kind === 'shell'
        ? request.command.shellScript
        : `exec ${request.command.argv.map(quoteShellArgument).join(' ')}`;
    const shellScript = request.cwd === undefined ? source : `cd ${quoteShellArgument(request.cwd)} &&\n${source}`;
    const connectionId = target.connectionId;
    if (connectionId === undefined) throw new Error('TOOL_STATE_CONFLICT');
    if (request.mode === 'background') {
      if (!context.sshSessionId || !this.sshSessions) throw new Error('SSH_SESSION_REQUIRED');
      const sshJob = await this.sshSessions.startJob(
        context,
        connectionId,
        target.fingerprint.configurationHash,
        context.sshSessionId,
        shellScript,
        request.timeoutSeconds,
        request.operationHash,
      );
      return { target: target.selector, status: sshJob.status, sshJob };
    }
    const result = await this.sshShell.execute(
      context,
      connectionId,
      shellScript,
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

  private executionId(context: ToolContext, target: ResolvedAgentTarget): string {
    if (!context.runId || !context.agentRuntimeId || !context.toolCallId) throw new Error('TOOL_STATE_CONFLICT');
    return hashOperation(
      {
        schemaVersion: 1,
        runId: context.runId,
        runtimeId: context.agentRuntimeId,
        toolCallId: context.toolCallId,
        target: {
          kind: target.fingerprint.kind,
          id: target.fingerprint.id,
          configurationHash: target.fingerprint.configurationHash,
          generation: target.workspaceGeneration ?? null,
        },
      },
      this.cryptoHash,
    );
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

  async listActiveJobs(
    context: ToolContext,
    target: ResolvedAgentTarget,
  ): Promise<
    | WorkspaceJobCapacityView
    | { activeCount: number; jobs: { jobId: string; status: SshJobView['status']; createdAt: number }[] }
  > {
    if (target.selector.target === 'ssh') {
      if (!this.sshSessions || target.connectionId === undefined) throw new Error('SSH_SESSION_NOT_FOUND');
      const jobs = await this.sshSessions.listJobs(context, target.connectionId);
      return { activeCount: jobs.length, jobs };
    }
    if (target.selector.target !== 'workspace' || target.workspaceGeneration === undefined)
      throw new Error('TOOL_ARGUMENTS_INVALID');
    return this.workspaceShell.listActiveJobs(context, target.selector.id, target.workspaceGeneration);
  }

  async sshJob(
    context: ToolContext,
    selector: AgentTargetSelector,
    jobId: string,
    action: 'status' | 'wait' | 'cancel',
    waitSeconds?: number,
  ): Promise<SshJobView> {
    if (selector.target !== 'ssh' || !this.sshSessions) throw new Error('TOOL_ARGUMENTS_INVALID');
    const target = await this.targets.resolve(context, selector);
    return this.sshSessions.job(context, target.connectionId!, jobId, action, waitSeconds);
  }

  async inspectSshSession(context: ToolContext, target: ResolvedAgentTarget): Promise<void> {
    if (!context.sshSessionId) return;
    if (!this.sshSessions || target.connectionId === undefined) throw new Error('SSH_SESSION_NOT_FOUND');
    const sessions = await this.sshSessions.list(context, target.connectionId, context.sshSessionId);
    if (sessions[0]?.status !== 'ready') throw new Error('SSH_SESSION_DISCONNECTED');
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
