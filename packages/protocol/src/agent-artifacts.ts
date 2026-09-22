export type AgentArtifactStatusDto = 'staging' | 'ready' | 'deleting' | 'deleted' | 'unavailable';
export type AgentArtifactFileKindDto = 'image' | 'document' | 'code' | 'archive' | 'media' | 'other';

export interface AgentArtifactRefDto {
  id: string;
  appId: string;
  originalName: string;
  mediaType: string;
  sha256: string | null;
  sizeBytes: number;
  status: AgentArtifactStatusDto;
  retained: boolean;
  version: number;
  createdAt: number;
  readyAt: number | null;
  expiresAt: number | null;
  deletedAt: number | null;
}

export interface AgentArtifactBeginRequestDto {
  name: string;
  mediaType: string;
  declaredBytes: number;
}

export interface AgentArtifactUploadReservationDto {
  artifactId: string;
  uploadUrl: string;
  expiresAt: number;
}

export interface AgentArtifactRetainRequestDto {
  retained: boolean;
  expectedVersion: number;
}

export interface AgentArtifactDeleteQueryDto {
  expectedVersion: number;
}

export interface AgentArtifactDeleteResponseDto {
  deleted: true;
}

export interface AgentArtifactLibraryQueryDto {
  limit: number;
  before?: string;
  q?: string;
  appId?: string;
  retained?: boolean;
  kind?: AgentArtifactFileKindDto;
}

export interface AgentArtifactPageDto {
  items: AgentArtifactRefDto[];
  nextCursor: string | null;
}

export interface AgentArtifactStorageSummaryDto {
  totalBytes: number;
  retainedBytes: number;
  protectedBytes: number;
  reclaimableBytes: number;
  stagingBytes: number;
  unavailableBytes: number;
  reservedBytes: number;
  limitBytes: number;
}

export interface AgentArtifactCleanupPreviewDto {
  confirmationId: string;
  expiresAt: number;
  selectedCount: number;
  selectedBytes: number;
  protectedCount: number;
  byApp: Array<{ appId: string; count: number; bytes: number }>;
}

export interface AgentArtifactCleanupConfirmRequestDto {
  confirmationId: string;
}

export interface AgentArtifactCleanupResultDto {
  deletedCount: number;
  deletedBytes: number;
  skippedCount: number;
  failedCount: number;
  partial: boolean;
}

export interface AgentArtifactAttachRequestDto {
  targetAppId: string;
  threadId: string;
  runId?: string;
  role: 'input';
  expectedVersion?: number;
}

export interface AgentArtifactAttachResponseDto {
  artifact: AgentArtifactRefDto;
  sourceAppId: string;
  targetAppId: string;
  threadId: string;
  runId: string | null;
  role: 'input';
  crossApp: boolean;
}
