import type { MessageResponseDto } from './common.js';

export type SuspendedSessionStatusDto = 'active' | 'disconnected';
export type SuspendedSessionOwnershipStateDto = 'available' | 'resuming' | 'attached';

export interface SuspendedSessionDto {
  id: string;
  originalWorkspaceId: string;
  connectionId: number;
  connectionName: string;
  suspendedAt: string;
  customName?: string;
  status: SuspendedSessionStatusDto;
  ownershipState: SuspendedSessionOwnershipStateDto;
  ownershipGeneration: number;
  ownershipLeaseExpiresAt?: number;
  attachedWorkspaceId?: string;
  disconnectedAt?: string;
}

export interface SuspendedSessionRenameRequestDto {
  customName: string;
}

export interface SuspendedSessionRenameResponseDto extends MessageResponseDto {
  customName: string;
}
