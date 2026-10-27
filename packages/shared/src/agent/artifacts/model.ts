import type { AgentArtifactStatus, AgentArtifactKind } from './values.js';

export interface AgentArtifactView {
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

export interface AgentArtifactStorageView {
	totalBytes: number;
	retainedBytes: number;
	protectedBytes: number;
	reclaimableBytes: number;
	stagingBytes: number;
	unavailableBytes: number;
	reservedBytes: number;
	limitBytes: number;
}

export interface AgentArtifactCleanupView {
	confirmationId: string;
	expiresAt: number;
	selectedCount: number;
	selectedBytes: number;
	protectedCount: number;
	byApp: { appId: string; count: number; bytes: number }[];
}

export interface AgentArtifactCleanupResult {
	deletedCount: number;
	deletedBytes: number;
	skippedCount: number;
	failedCount: number;
	partial: boolean;
}

export interface AgentArtifactAttachmentView {
	artifact: AgentArtifactView;
	sourceAppId: string;
	targetAppId: string;
	threadId: string;
	runId: string | null;
	role: 'input';
	crossApp: boolean;
}
