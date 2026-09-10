import type { Scope } from '../agent.types';

export type ArtifactStatus = 'staging' | 'ready' | 'deleting' | 'deleted' | 'unavailable';

export interface ArtifactRef {
  id: string;
  appId: string;
  originalName: string;
  mediaType: string;
  sha256: string | null;
  sizeBytes: number;
  status: ArtifactStatus;
  retained: boolean;
  version: number;
  createdAt: number;
  readyAt: number | null;
  expiresAt: number | null;
  deletedAt: number | null;
}

export interface ArtifactBeginMeta {
  name: string;
  mediaType: string;
  declaredBytes: number;
}

export interface UploadReservation {
  artifactId: string;
  declaredBytes: number;
  expiresAt: number;
}

export interface ArtifactReadRange {
  start: number;
  endInclusive: number;
}

export interface ArtifactLibraryQuery {
  limit: number;
  before?: string;
  q?: string;
  appId?: string;
  retained?: boolean;
}

export interface ArtifactLibraryPage {
  items: ArtifactRef[];
  nextCursor: string | null;
}

export interface ArtifactStorageSummary {
  totalBytes: number;
  retainedBytes: number;
  protectedBytes: number;
  reclaimableBytes: number;
  stagingBytes: number;
  unavailableBytes: number;
  reservedBytes: number;
  limitBytes: number;
}

export interface ArtifactLimitSnapshot {
  maxSingleArtifactBytes: number;
  maxGlobalArtifactBytes: number;
  minFreeDiskBytes: number;
}

export interface ArtifactLimitPolicyPort {
  forUser(userId: number): Promise<ArtifactLimitSnapshot>;
}

export interface ArtifactCleanupPreview {
  confirmationId: string;
  expiresAt: number;
  selectedCount: number;
  selectedBytes: number;
  protectedCount: number;
  byApp: Array<{ appId: string; count: number; bytes: number }>;
}

export interface ArtifactCleanupResult {
  deletedCount: number;
  deletedBytes: number;
  skippedCount: number;
  failedCount: number;
  partial: boolean;
}

export interface ArtifactAttachInput {
  targetAppId: string;
  threadId: string;
  runId?: string;
  role: 'input';
  expectedVersion?: number;
}

export interface ArtifactAttachResult {
  artifact: ArtifactRef;
  sourceAppId: string;
  targetAppId: string;
  threadId: string;
  runId: string | null;
  role: 'input';
  crossApp: boolean;
}

export interface ArtifactPort {
  begin(scope: Scope, meta: ArtifactBeginMeta): Promise<UploadReservation>;
  get(scope: Scope, artifactId: string): Promise<ArtifactRef | null>;
  write(scope: Scope, artifactId: string, source: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<ArtifactRef>;
  read(scope: Scope, artifactId: string, range: ArtifactReadRange): AsyncIterable<Uint8Array>;
  retain(scope: Scope, artifactId: string, retained: boolean, expectedVersion: number): Promise<ArtifactRef>;
  delete(scope: Scope, artifactId: string, expectedVersion: number): Promise<void>;
  listLibrary(userId: number, query: ArtifactLibraryQuery): Promise<ArtifactLibraryPage>;
  storageSummary(userId: number): Promise<ArtifactStorageSummary>;
  cleanupPreview(userId: number): Promise<ArtifactCleanupPreview>;
  cleanupConfirm(userId: number, confirmationId: string): Promise<ArtifactCleanupResult>;
  attach(userId: number, artifactId: string, input: ArtifactAttachInput): Promise<ArtifactAttachResult>;
}

export type { Scope } from '../agent.types';
