import type { ToolContext } from '../../../modules/agent/capabilities/tool.types';
import type { WorkspaceFileTargetPort } from '../../../modules/agent/workspace-runtime/workspace-file-target.port';
import type {
  WorkspaceApplyPatchRequest,
  WorkspaceFileDeleteRequest,
  WorkspaceFileListRequest,
  WorkspaceFileMoveRequest,
  WorkspaceFileReadRequest,
  WorkspaceFileWriteRequest,
  WorkspaceRuntimeControllerPort,
  WorkspaceSearchRequest,
} from '../../../modules/agent/workspace-runtime/workspace-runtime-controller.port';
import type { AgentWorkspaceRepositoryPort } from '../../../modules/agent/workspace-runtime/workspace-runtime.repository.port';

export class WorkspaceFileTargetAdapter implements WorkspaceFileTargetPort {
  constructor(
    private readonly repository: AgentWorkspaceRepositoryPort,
    private readonly controller: WorkspaceRuntimeControllerPort,
  ) {}

  async stat(context: ToolContext, workspaceId: string, generation: number, path: string) {
    await this.assertTarget(context, workspaceId, generation);
    return this.controller.statWorkspacePath(workspaceId, generation, path, context.signal);
  }

  async read(context: ToolContext, workspaceId: string, generation: number, request: WorkspaceFileReadRequest) {
    await this.assertTarget(context, workspaceId, generation);
    return this.controller.readWorkspaceFile(workspaceId, generation, request, context.signal);
  }

  async list(context: ToolContext, workspaceId: string, generation: number, request: WorkspaceFileListRequest) {
    await this.assertTarget(context, workspaceId, generation);
    return this.controller.listWorkspaceFiles(workspaceId, generation, request, context.signal);
  }

  async search(context: ToolContext, workspaceId: string, generation: number, request: WorkspaceSearchRequest) {
    await this.assertTarget(context, workspaceId, generation);
    return this.controller.searchWorkspace(workspaceId, generation, request, context.signal);
  }

  async write(context: ToolContext, workspaceId: string, generation: number, request: WorkspaceFileWriteRequest) {
    await this.assertTarget(context, workspaceId, generation);
    return this.controller.writeWorkspaceFile(workspaceId, generation, request, context.signal);
  }

  async move(context: ToolContext, workspaceId: string, generation: number, request: WorkspaceFileMoveRequest) {
    await this.assertTarget(context, workspaceId, generation);
    return this.controller.moveWorkspaceFile(workspaceId, generation, request, context.signal);
  }

  async delete(context: ToolContext, workspaceId: string, generation: number, request: WorkspaceFileDeleteRequest) {
    await this.assertTarget(context, workspaceId, generation);
    return this.controller.deleteWorkspaceFile(workspaceId, generation, request, context.signal);
  }

  async applyPatch(context: ToolContext, workspaceId: string, generation: number, request: WorkspaceApplyPatchRequest) {
    await this.assertTarget(context, workspaceId, generation);
    return this.controller.applyWorkspacePatch(workspaceId, generation, request, context.signal);
  }

  private async assertTarget(context: ToolContext, workspaceId: string, generation: number): Promise<void> {
    const workspace = await this.repository.getWorkspace(context, workspaceId);
    if (!workspace || ['deleted', 'failed'].includes(workspace.status)) throw new Error('NOT_FOUND');
    if (workspace.runId !== context.runId || workspace.agentRuntimeId !== context.agentRuntimeId) {
      throw new Error('RESOURCE_FORBIDDEN');
    }
    if (workspace.generation !== generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
  }
}
