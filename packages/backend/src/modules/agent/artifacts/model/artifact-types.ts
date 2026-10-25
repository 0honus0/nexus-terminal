import type { AgentArtifactStatus, AgentArtifactKind } from '@nexus-terminal/shared/agent/artifacts/values';

export interface ArtifactScope {
	userId: number;
	appId: string;
}

export type ArtifactActor =
	| { kind: 'model'; userId: number; appId: string; runId: string; stepIndex: number; requestHash: string }
	| { kind: 'session'; userId: number; appId: string; token: string }
	| { kind: 'tool'; userId: number; appId: string; runId: string; operationId: string; operationHash: string };

export interface ArtifactRecord {
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

export interface ArtifactBegin {
	name: string;
	mediaType: string;
	declaredBytes: number;
}

export interface ArtifactQuery {
	appId: string | null;
	retained: boolean | null;
	kind: AgentArtifactKind | null;
	q: string;
	offset: number;
	limit: number;
}

export interface ArtifactAttachment {
	expectedVersion: number;
	targetAppId: string;
	threadId: string;
	runId: string | null;
}

export interface ArtifactFacts {
	settingsVersion: number;
	identityUserId: number | null;
	appExists: boolean;
	appEnabled: boolean;
	totalBytes: number;
	totalCount: number;
}

export interface ArtifactMutationFacts {
	record: ArtifactRecord;
	references: number;
	now: number;
}

export interface ArtifactWriteFacts {
	bytes: number;
	sha256: string;
}

export interface ArtifactStorageTotals {
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
	items: ArtifactRecord[];
	protectedCount: number;
}

export interface ArtifactCleanupResult {
	deletedCount: number;
	deletedBytes: number;
	skippedCount: number;
	failedCount: number;
	partial: boolean;
}

export interface ArtifactReadRange {
	start: number;
	endInclusive: number;
}

export interface ArtifactContent {
	id: string;
	version: number;
	name: string;
	mediaType: string;
	sha256: string;
	bytes: Uint8Array;
}
