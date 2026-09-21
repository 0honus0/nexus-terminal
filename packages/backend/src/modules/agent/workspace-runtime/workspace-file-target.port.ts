import type { ToolContext } from '../capabilities/tool.types';
import type {
  WorkspaceApplyPatchRequest,
  WorkspaceApplyPatchResult,
  WorkspaceFileDeleteRequest,
  WorkspaceFileDeleteResult,
  WorkspaceFileListRequest,
  WorkspaceFileListResult,
  WorkspaceFileMoveRequest,
  WorkspaceFileMoveResult,
  WorkspaceFileReadRequest,
  WorkspaceFileReadResult,
  WorkspaceFileStatResult,
  WorkspaceFileWriteRequest,
  WorkspaceFileWriteResult,
  WorkspaceSearchRequest,
  WorkspaceSearchResult,
} from './workspace-runtime-controller.port';

export interface WorkspaceFileTargetPort {
  stat(context: ToolContext, workspaceId: string, generation: number, path: string): Promise<WorkspaceFileStatResult>;
  read(
    context: ToolContext,
    workspaceId: string,
    generation: number,
    request: WorkspaceFileReadRequest,
  ): Promise<WorkspaceFileReadResult>;
  list(
    context: ToolContext,
    workspaceId: string,
    generation: number,
    request: WorkspaceFileListRequest,
  ): Promise<WorkspaceFileListResult>;
  search(
    context: ToolContext,
    workspaceId: string,
    generation: number,
    request: WorkspaceSearchRequest,
  ): Promise<WorkspaceSearchResult>;
  write(
    context: ToolContext,
    workspaceId: string,
    generation: number,
    request: WorkspaceFileWriteRequest,
  ): Promise<WorkspaceFileWriteResult>;
  move(
    context: ToolContext,
    workspaceId: string,
    generation: number,
    request: WorkspaceFileMoveRequest,
  ): Promise<WorkspaceFileMoveResult>;
  delete(
    context: ToolContext,
    workspaceId: string,
    generation: number,
    request: WorkspaceFileDeleteRequest,
  ): Promise<WorkspaceFileDeleteResult>;
  applyPatch(
    context: ToolContext,
    workspaceId: string,
    generation: number,
    request: WorkspaceApplyPatchRequest,
  ): Promise<WorkspaceApplyPatchResult>;
}
