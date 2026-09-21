import type { ToolContext } from '../../../modules/agent/capabilities/tool.types';
import type {
  WorkspaceJobCall,
  WorkspaceJobView,
} from '../../../modules/agent/workspace-runtime/workspace-runtime-gateway.port';
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
  ) {}

  execute(
    context: ToolContext,
    workspaceId: string,
    generation: number,
    call: WorkspaceJobCall,
    mode: WorkspaceShellMode,
  ): Promise<WorkspaceJobView> {
    const grant = { workspaceId, generation };
    return mode === 'background'
      ? this.gateway.startJob(grant, call, context.signal)
      : this.gateway.invoke(grant, call, context.signal);
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
