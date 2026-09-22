import type {
  WorkspaceProtocolEventDto,
  WorkspaceProtocolRequestDto,
  WorkspaceProtocolResponseDto,
} from '@nexus-terminal/protocol/workspace';

export type WorkspaceProtocolRequest = WorkspaceProtocolRequestDto<Record<string, unknown>>;
export type WorkspaceProtocolResponse<T = unknown> = WorkspaceProtocolResponseDto<T>;
export type WorkspaceProtocolEvent<T = unknown> = WorkspaceProtocolEventDto<T>;
