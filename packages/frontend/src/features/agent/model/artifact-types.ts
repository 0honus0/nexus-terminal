import type { AgentArtifactKind, AgentArtifactStatus } from '@nexus-terminal/shared/agent/artifacts/values';

export interface ManagedArtifact {
	id: string;
	appId: string;
	name: string;
	mediaType: string;
	kind: AgentArtifactKind;
	sizeBytes: number;
	sha256: string | null;
	status: AgentArtifactStatus;
	retained: boolean;
	version: number;
	createdAt: number;
	readyAt: number | null;
	expiresAt: number | null;
	deletedAt: number | null;
}

export interface ArtifactFilters {
	appId: string;
	kind: AgentArtifactKind | '';
	retention: 'all' | 'retained' | 'unretained';
	query: string;
}

export interface ArtifactPage {
	items: ManagedArtifact[];
	nextOffset: number | null;
}

export interface ArtifactAttachmentTarget {
	appId: string;
	threadId: string;
	runId: string | null;
}

export interface ArtifactAttachment {
	artifact: ManagedArtifact;
	sourceAppId: string;
	targetAppId: string;
	threadId: string;
	runId: string | null;
	role: 'input';
	crossApp: boolean;
}

export interface ArtifactStorage {
	totalBytes: number;
	retainedBytes: number;
	protectedBytes: number;
	reclaimableBytes: number;
	stagingBytes: number;
	unavailableBytes: number;
	reservedBytes: number;
	limitBytes: number;
}

export interface ArtifactCleanupPlan {
	id: string;
	expiresAt: number;
	selectedCount: number;
	selectedBytes: number;
	protectedCount: number;
	byApp: { appId: string; count: number; bytes: number }[];
}

export interface ArtifactCleanupResult {
	deletedCount: number;
	deletedBytes: number;
	skippedCount: number;
	failedCount: number;
	partial: boolean;
}
