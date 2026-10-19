import type { AgentArtifactKind } from './values.js';
import type {
	AgentArtifactView,
	AgentArtifactStorageView,
	AgentArtifactCleanupView,
	AgentArtifactCleanupResult,
	AgentArtifactAttachmentView,
} from './model.js';

export interface AgentArtifactBeginRequest {
	name: string;
	mediaType: string;
	declaredBytes: number;
}

export interface AgentArtifactVersionRequest {
	expectedVersion: number;
}

export interface AgentArtifactRetainRequest {
	expectedVersion: number;
	retained: boolean;
}

export interface AgentArtifactAttachRequest {
	expectedVersion: number;
	targetAppId: string;
	threadId: string;
	runId: string | null;
}

export interface AgentArtifactCleanupRequest {
	confirmationId: string;
}

export interface AgentArtifactQuery {
	appId: string | null;
	retained: boolean | null;
	kind: AgentArtifactKind | null;
	q: string;
	offset: number;
	limit: number;
}

export interface AgentArtifactResponse {
	artifact: AgentArtifactView;
}

export interface AgentArtifactListResponse {
	items: AgentArtifactView[];
	nextOffset: number | null;
}

export interface AgentArtifactStorageResponse {
	storage: AgentArtifactStorageView;
}

export interface AgentArtifactCleanupResponse {
	confirmation: AgentArtifactCleanupView;
}

export interface AgentArtifactCleanupResultResponse {
	result: AgentArtifactCleanupResult;
}

export interface AgentArtifactAttachResponse {
	attachment: AgentArtifactAttachmentView;
}

export interface AgentArtifactUploadHeaders {
	ifMatch: string;
	contentType: 'application/octet-stream';
}

export interface AgentArtifactDeleteResponse {
	deleted: true;
}

export interface AgentArtifactDownloadRange {
	start: number;
	endInclusive: number;
	partial: boolean;
}
