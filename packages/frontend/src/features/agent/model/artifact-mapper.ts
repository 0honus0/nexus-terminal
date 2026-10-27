import type {
	AgentArtifactView,
	AgentArtifactStorageView,
	AgentArtifactCleanupView,
	AgentArtifactCleanupResult,
	AgentArtifactAttachmentView,
} from '@nexus-terminal/shared/agent/artifacts/model';
import type {
	ManagedArtifact,
	ArtifactStorage,
	ArtifactCleanupPlan,
	ArtifactCleanupResult,
	ArtifactAttachment,
} from './artifact-types';

export function fromArtifactAttachment(value: AgentArtifactAttachmentView): ArtifactAttachment {
	return {
		artifact: fromArtifact(value.artifact),
		sourceAppId: value.sourceAppId,
		targetAppId: value.targetAppId,
		threadId: value.threadId,
		runId: value.runId,
		role: value.role,
		crossApp: value.crossApp,
	};
}

export function fromArtifact(value: AgentArtifactView): ManagedArtifact {
	return {
		id: value.id,
		appId: value.appId,
		name: value.name,
		mediaType: value.mediaType,
		kind: value.kind,
		sizeBytes: value.sizeBytes,
		sha256: value.sha256,
		status: value.status,
		retained: value.retained,
		version: value.version,
		createdAt: value.createdAt,
		readyAt: value.readyAt,
		expiresAt: value.expiresAt,
		deletedAt: value.deletedAt,
	};
}

export function fromArtifactStorage(value: AgentArtifactStorageView): ArtifactStorage {
	return {
		totalBytes: value.totalBytes,
		retainedBytes: value.retainedBytes,
		protectedBytes: value.protectedBytes,
		reclaimableBytes: value.reclaimableBytes,
		stagingBytes: value.stagingBytes,
		unavailableBytes: value.unavailableBytes,
		reservedBytes: value.reservedBytes,
		limitBytes: value.limitBytes,
	};
}

export function fromArtifactCleanup(value: AgentArtifactCleanupView): ArtifactCleanupPlan {
	return {
		id: value.confirmationId,
		expiresAt: value.expiresAt,
		selectedCount: value.selectedCount,
		selectedBytes: value.selectedBytes,
		protectedCount: value.protectedCount,
		byApp: value.byApp.map((item) => ({ appId: item.appId, count: item.count, bytes: item.bytes })),
	};
}

export function fromArtifactCleanupResult(value: AgentArtifactCleanupResult): ArtifactCleanupResult {
	return {
		deletedCount: value.deletedCount,
		deletedBytes: value.deletedBytes,
		skippedCount: value.skippedCount,
		failedCount: value.failedCount,
		partial: value.partial,
	};
}
