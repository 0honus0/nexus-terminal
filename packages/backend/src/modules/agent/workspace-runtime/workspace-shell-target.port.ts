import type { ToolContext } from '../capabilities/tool.types';
import type { WorkspaceJobCall, WorkspaceJobView } from './workspace-runtime-gateway.port';

export type WorkspaceShellMode = 'foreground' | 'background';
export type WorkspaceShellJobAction = 'status' | 'wait' | 'cancel';

export interface WorkspaceShellTargetPort {
  execute(
    context: ToolContext,
    workspaceId: string,
    generation: number,
    call: WorkspaceJobCall,
    mode: WorkspaceShellMode,
  ): Promise<WorkspaceJobView>;
  resolveOwnedJob(context: ToolContext, workspaceId: string, jobId: string): Promise<WorkspaceJobView>;
  controlJob(
    context: ToolContext,
    workspaceId: string,
    generation: number,
    jobId: string,
    action: WorkspaceShellJobAction,
    waitSeconds?: number,
  ): Promise<WorkspaceJobView>;
}
