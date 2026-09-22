import type { SuspendedSessionDto } from './ssh-suspend.js';

export interface WorkspaceProtocolRequestDto<TPayload = Record<string, unknown>> {
  type: string;
  requestId?: string;
  payload?: TPayload;
}

export interface WorkspaceProtocolResponsePayloadDto<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface WorkspaceProtocolResponseDto<T = unknown> {
  type: 'response';
  requestId: string;
  payload: WorkspaceProtocolResponsePayloadDto<T>;
}

export interface WorkspaceProtocolEventDto<T = unknown, TType extends string = string> {
  type: TType;
  payload?: T;
}

export interface WorkspaceTerminalViewportDto {
  columns: number;
  rows: number;
}

export interface WorkspaceSuspendMarkRequestDto {
  terminalSnapshot?: string;
}

export interface WorkspaceSuspendMarkResponseDto {
  suspendedSessionId: string;
}

export type WorkspaceSuspendUnmarkRequestDto = Record<string, never>;

export type WorkspaceSuspendListResponseDto = SuspendedSessionDto[];

export interface WorkspaceSuspendResumeRequestDto {
  suspendedSessionId: string;
  workspaceId: string;
  viewport?: WorkspaceTerminalViewportDto;
  takeover?: boolean;
}

export interface WorkspaceSuspendResumeResponseDto {
  workspaceId: string;
  connectionId: number;
  connectionName: string;
  resumedFrom: string;
  historyAvailable: boolean;
  ownershipGeneration: number;
  ownershipLeaseExpiresAt: number;
  binaryProtocolVersion: number;
}

export interface WorkspaceSuspendOwnerRenewResponseDto {
  generation: number;
  leaseExpiresAt: number;
}

export interface WorkspaceSuspendHistoryPreviousResponseDto {
  hasMore: boolean;
}

export interface WorkspaceSuspendHistoryResetResponseDto {
  available: boolean;
}

export interface WorkspaceSuspendSessionRequestDto {
  suspendedSessionId: string;
}

export interface WorkspaceSuspendRenameRequestDto {
  suspendedSessionId: string;
  name: string;
}

export interface WorkspaceSuspendAutoTerminatedEventDto {
  suspendedSessionId: string;
  reason: string;
}

export type WorkspaceSuspendRevokedReasonDto = 'takeover' | 'lease_expired';

export interface WorkspaceSuspendRevokedEventDto {
  suspendedSessionId: string;
  generation: number;
  reason: WorkspaceSuspendRevokedReasonDto;
  message: string;
}

export interface WorkspaceSuspendRequestMapDto {
  'suspend.mark': WorkspaceSuspendMarkRequestDto;
  'suspend.unmark': WorkspaceSuspendUnmarkRequestDto;
  'suspend.list': Record<string, never>;
  'suspend.resume': WorkspaceSuspendResumeRequestDto;
  'suspend.owner.renew': Record<string, never>;
  'suspend.history.previous': Record<string, never>;
  'suspend.history.reset': Record<string, never>;
  'suspend.terminate': WorkspaceSuspendSessionRequestDto;
  'suspend.remove': WorkspaceSuspendSessionRequestDto;
  'suspend.rename': WorkspaceSuspendRenameRequestDto;
}

export interface WorkspaceSuspendResponseMapDto {
  'suspend.mark': WorkspaceSuspendMarkResponseDto;
  'suspend.unmark': null;
  'suspend.list': WorkspaceSuspendListResponseDto;
  'suspend.resume': WorkspaceSuspendResumeResponseDto;
  'suspend.owner.renew': WorkspaceSuspendOwnerRenewResponseDto;
  'suspend.history.previous': WorkspaceSuspendHistoryPreviousResponseDto;
  'suspend.history.reset': WorkspaceSuspendHistoryResetResponseDto;
  'suspend.terminate': null;
  'suspend.remove': null;
  'suspend.rename': null;
}

export interface WorkspaceSuspendEventMapDto {
  'suspend.autoTerminated': WorkspaceSuspendAutoTerminatedEventDto;
  'suspend.revoked': WorkspaceSuspendRevokedEventDto;
}
