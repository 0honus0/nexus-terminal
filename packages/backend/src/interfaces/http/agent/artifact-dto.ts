import type {
  AgentArtifactAttachResponseDto,
  AgentArtifactCleanupPreviewDto,
  AgentArtifactCleanupResultDto,
  AgentArtifactPageDto,
  AgentArtifactRefDto,
  AgentArtifactStorageSummaryDto,
} from '@nexus-terminal/protocol/agent-artifacts';
import type { AgentArtifactFacade } from '../../../modules/agent/public';

type ArtifactRef = NonNullable<Awaited<ReturnType<AgentArtifactFacade['get']>>>;
type ArtifactPage = Awaited<ReturnType<AgentArtifactFacade['listLibrary']>>;
type ArtifactAttachResult = Awaited<ReturnType<AgentArtifactFacade['attach']>>;

export const artifactDto = (artifact: ArtifactRef): AgentArtifactRefDto => ({
  id: artifact.id,
  appId: artifact.appId,
  originalName: artifact.originalName,
  mediaType: artifact.mediaType,
  sha256: artifact.sha256,
  sizeBytes: artifact.sizeBytes,
  status: artifact.status,
  retained: artifact.retained,
  version: artifact.version,
  createdAt: artifact.createdAt,
  readyAt: artifact.readyAt,
  expiresAt: artifact.expiresAt,
  deletedAt: artifact.deletedAt,
});

export const artifactPageDto = (page: ArtifactPage): AgentArtifactPageDto => ({
  items: page.items.map(artifactDto),
  nextCursor: page.nextCursor,
});

export const artifactStorageSummaryDto = (
  summary: Awaited<ReturnType<AgentArtifactFacade['storageSummary']>>,
): AgentArtifactStorageSummaryDto => ({
  totalBytes: summary.totalBytes,
  retainedBytes: summary.retainedBytes,
  protectedBytes: summary.protectedBytes,
  reclaimableBytes: summary.reclaimableBytes,
  stagingBytes: summary.stagingBytes,
  unavailableBytes: summary.unavailableBytes,
  reservedBytes: summary.reservedBytes,
  limitBytes: summary.limitBytes,
});

export const artifactCleanupPreviewDto = (
  preview: Awaited<ReturnType<AgentArtifactFacade['cleanupPreview']>>,
): AgentArtifactCleanupPreviewDto => ({
  confirmationId: preview.confirmationId,
  expiresAt: preview.expiresAt,
  selectedCount: preview.selectedCount,
  selectedBytes: preview.selectedBytes,
  protectedCount: preview.protectedCount,
  byApp: preview.byApp.map((entry) => ({ ...entry })),
});

export const artifactCleanupResultDto = (
  result: Awaited<ReturnType<AgentArtifactFacade['cleanupConfirm']>>,
): AgentArtifactCleanupResultDto => ({
  deletedCount: result.deletedCount,
  deletedBytes: result.deletedBytes,
  skippedCount: result.skippedCount,
  failedCount: result.failedCount,
  partial: result.partial,
});

export const artifactAttachResponseDto = (result: ArtifactAttachResult): AgentArtifactAttachResponseDto => ({
  artifact: artifactDto(result.artifact),
  sourceAppId: result.sourceAppId,
  targetAppId: result.targetAppId,
  threadId: result.threadId,
  runId: result.runId,
  role: result.role,
  crossApp: result.crossApp,
});
