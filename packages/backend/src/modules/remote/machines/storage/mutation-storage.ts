import type { MutationState, MutationOrigin, MutationOutcome } from '@nexus-terminal/shared/remote/mutations/values';

export interface StoredMutationClaim {
	id: string;
	keys: string[];
	now: number;
	ownerId: string;
	origin: MutationOrigin;
	targets: { targetId: number; fingerprint: string }[];
}

export interface StoredMutationEvidence {
	id: string;
	claimRevision: number;
	outcome: MutationOutcome;
	observedAt: number;
	note: string;
	recordedBy: number;
	createdAt: number;
}

export interface StoredMutationObservation {
	id: string;
	origin: MutationOrigin;
	ownerId: string;
	state: MutationState;
	revision: number;
	createdAt: number;
	blockedAt: number | null;
	releasedAt: number | null;
	targets: { targetId: number; fingerprint: string }[];
	evidence: StoredMutationEvidence[];
}

export type StoredMutationRecoveryTask =
	| { kind: 'evidence'; evidence: StoredMutationEvidence }
	| { kind: 'release'; evidenceId: string; releasedAt: number };

export class MutationStorageRefusal extends Error {
	constructor(readonly kind: 'not_found' | 'version_conflict') {
		super('Mutation storage refused: ' + kind);
	}
}

export interface MachineMutationStorage {
	ownExecution(work: () => Promise<void>): Promise<void>;
	acquire(
		claim: StoredMutationClaim,
		maxClaims: number,
		maxHistory: number,
		authority?: { digest: string; admit(identity: number | null): void },
	): Promise<'acquired' | 'conflict' | 'limit_exceeded'>;
	settle(id: string, keys: string[], blocked: boolean, now: number): Promise<void>;
	reconcile(now: number): Promise<void>;
	list(
		digest: string,
		after: string | null,
		limit: number,
		admit: (identity: number | null) => void,
	): Promise<StoredMutationObservation[]>;
	get(
		digest: string,
		id: string,
		admit: (identity: number | null) => void,
	): Promise<StoredMutationObservation | null>;
	recover(
		digest: string,
		id: string,
		revision: number,
		admit: (identity: number | null) => void,
		decide: (current: StoredMutationObservation) => StoredMutationRecoveryTask,
	): Promise<StoredMutationObservation>;
}
