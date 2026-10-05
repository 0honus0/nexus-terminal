import type { WorkspaceJobView, WorkspaceJobCapacityView } from '@nexus-terminal/protocol/runner';
import type { AgentSettingsService } from '../../../modules/agent/host/agent-settings.service';
import type { ToolContext } from '../../../modules/agent/capabilities/tool.types';
import type { WorkspaceJobCall } from '../../../modules/agent/workspace-runtime/workspace-runtime-gateway.port';
import type { AgentWorkspaceRepositoryPort } from '../../../modules/agent/workspace-runtime/workspace-runtime.repository.port';
import type {
  WorkspaceShellJobAction,
  WorkspaceShellMode,
  WorkspaceShellTargetPort,
} from '../../../modules/agent/workspace-runtime/workspace-shell-target.port';
import type { WorkspaceRuntimeGatewayPort } from '../../../modules/agent/workspace-runtime/workspace-runtime-gateway.port';

export class WorkspaceShellTargetAdapter implements WorkspaceShellTargetPort {
  constructor(
    private readonly repository: AgentWorkspaceRepositoryPort,
    private readonly gateway: WorkspaceRuntimeGatewayPort,
    private readonly settings: AgentSettingsService,
  ) {}

  async execute(
    context: ToolContext,
    workspaceId: string,
    generation: number,
    call: Omit<WorkspaceJobCall, 'maxConcurrentJobs'>,
    mode: WorkspaceShellMode,
  ): Promise<WorkspaceJobView> {
    const grant = { workspaceId, generation };
    const maxConcurrentJobs = (await this.settings.get(context.userId)).effectiveSettings.performance
      .maxConcurrentWorkspaceJobs;
    const configuredCall = { ...call, maxConcurrentJobs };
    return mode === 'background'
      ? this.gateway.startJob(grant, configuredCall, context.signal)
      : this.gateway.invoke(grant, configuredCall, context.signal);
  }

  async resolveOwnedJob(context: ToolContext, workspaceId: string, jobId: string): Promise<WorkspaceJobView> {
    const [workspace, job] = await Promise.all([
      this.repository.getWorkspace(context, workspaceId),
      this.gateway.queryJob(jobId, context.signal),
    ]);
    if (!workspace) throw new Error('NOT_FOUND');
    if (workspace.runId !== context.runId || workspace.agentRuntimeId !== context.agentRuntimeId) {
      throw new Error('RESOURCE_FORBIDDEN');
    }
    if (job.workspaceId !== workspaceId) throw new Error('RESOURCE_FORBIDDEN');
    return job;
  }

  async listActiveJobs(
    context: ToolContext,
    workspaceId: string,
    generation: number,
  ): Promise<WorkspaceJobCapacityView> {
    const workspace = await this.repository.getWorkspace(context, workspaceId);
    if (!workspace || workspace.runId !== context.runId || workspace.agentRuntimeId !== context.agentRuntimeId)
      throw new Error('RESOURCE_FORBIDDEN');
    if (workspace.generation !== generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
    const view = await this.gateway.listActiveJobs({ workspaceId, generation }, context.signal);
    const capacity = (await this.settings.get(context.userId)).effectiveSettings.performance.maxConcurrentWorkspaceJobs;
    return { ...view, activeCount: view.jobs.length, capacity };
  }

  async controlJob(
    context: ToolContext,
    workspaceId: string,
    generation: number,
    jobId: string,
    action: WorkspaceShellJobAction,
    waitSeconds?: number,
  ): Promise<WorkspaceJobView> {
    const job =
      action === 'status'
        ? await this.gateway.queryJob(jobId, context.signal)
        : action === 'wait'
          ? await this.gateway.waitJob(jobId, (waitSeconds ?? 1) * 1000, context.signal)
          : await this.gateway.cancelJob(jobId, context.signal);
    if (job.workspaceId !== workspaceId || job.generation !== generation) throw new Error('RESOURCE_CHANGED');
    return job;
  }
}
