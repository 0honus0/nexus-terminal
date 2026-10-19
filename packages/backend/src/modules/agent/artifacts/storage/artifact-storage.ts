import type { AgentArtifactStatus, AgentArtifactKind } from '@nexus-terminal/shared/agent/artifacts/values';

export interface StoredArtifactScope {
	userId: number;
	appId: string;
}

export type StoredArtifactAuthorization =
	{ kind: 'session'; digest: string } | { kind: 'tool'; runId: string; operationId: string; operationHash: string };

export interface StoredArtifact {
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

export interface StoredArtifactFacts {
	settingsVersion: number;
	identityUserId: number | null;
	appExists: boolean;
	appEnabled: boolean;
	totalBytes: number;
	totalCount: number;
}

export interface StoredArtifactCreation {
	id: string;
	name: string;
	mediaType: string;
	kind: AgentArtifactKind;
	sizeBytes: number;
	expiresAt: number;
	now: number;
}

export interface StoredArtifactChange {
	kind: 'upload' | 'retain' | 'delete';
	retained: boolean | null;
}

export interface StoredArtifactQuery {
	appId: string | null;
	retained: boolean | null;
	kind: AgentArtifactKind | null;
	q: string;
	offset: number;
	limit: number;
}

export interface StoredArtifactAttach {
	targetAppId: string;
	threadId: string;
	runId: string | null;
}

export interface StoredArtifactCleanup {
	id: string;
	expiresAt: number;
	items: StoredArtifact[];
	protectedCount: number;
}

export interface StoredArtifactSummary {
	totalBytes: number;
	retainedBytes: number;
	protectedBytes: number;
	reclaimableBytes: number;
	stagingBytes: number;
	unavailableBytes: number;
	reservedBytes: number;
}

export class ArtifactStorageRefusal extends Error {
	constructor(readonly code: 'not_found' | 'version_conflict') {
		super(code);
	}
}

export interface ArtifactStorage {
	recovery(): Promise<{ userId: number; record: StoredArtifact }[]>;
	getAccessible(
		scope: StoredArtifactScope,
		auth: StoredArtifactAuthorization,
		id: string,
		admit: (facts: StoredArtifactFacts) => void,
		decide: (record: StoredArtifact, sourceEnabled: boolean) => void,
	): Promise<StoredArtifact>;
	create(
		scope: StoredArtifactScope,
		auth: StoredArtifactAuthorization,
		input: StoredArtifactCreation,
		admit: (facts: StoredArtifactFacts) => void,
	): Promise<StoredArtifact>;
	get(scope: StoredArtifactScope, id: string): Promise<StoredArtifact | null>;
	list(userId: number, query: StoredArtifactQuery): Promise<StoredArtifact[]>;
	summary(userId: number, now: number): Promise<StoredArtifactSummary>;
	mutate(
		scope: StoredArtifactScope,
		auth: StoredArtifactAuthorization,
		id: string,
		version: number,
		clock: () => number,
		task: StoredArtifactChange,
		admit: (facts: StoredArtifactFacts) => void,
		decide: (record: StoredArtifact, references: number, now: number) => void,
	): Promise<StoredArtifact>;
	settle(
		scope: StoredArtifactScope,
		id: string,
		version: number,
		status: 'ready' | 'deleted' | 'unavailable',
		hash: string | null,
		now: number,
	): Promise<StoredArtifact>;
	attach(
		scope: StoredArtifactScope,
		auth: StoredArtifactAuthorization,
		id: string,
		version: number,
		input: StoredArtifactAttach,
		clock: () => number,
		admit: (facts: StoredArtifactFacts) => void,
		decide: (record: StoredArtifact, targetEnabled: boolean, now: number) => void,
	): Promise<StoredArtifact>;
	detach(
		scope: StoredArtifactScope,
		auth: StoredArtifactAuthorization,
		id: string,
		version: number,
		threadId: string,
		now: number,
		admit: (facts: StoredArtifactFacts) => void,
	): Promise<StoredArtifact>;
	previewCleanup(
		userId: number,
		auth: StoredArtifactAuthorization,
		id: string,
		ttlMs: number,
		clock: () => number,
		admit: (identity: number | null, confirmations: number) => void,
		limit: number,
	): Promise<StoredArtifactCleanup>;
	claimCleanup(
		userId: number,
		auth: StoredArtifactAuthorization,
		id: string,
		clock: () => number,
		admit: (identity: number | null) => void,
		decide: (record: StoredArtifact, references: number, now: number) => void,
	): Promise<StoredArtifact[]>;
}
