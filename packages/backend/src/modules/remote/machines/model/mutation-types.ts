import type { MutationState, MutationOrigin, MutationOutcome } from '@nexus-terminal/shared/remote/mutations/values';

/** A confirmed application refusal may release a claim after its resources have closed. */
export class MachineMutationRejection extends Error {
	constructor(
		message: string,
		readonly outcome: 'not_started' | 'failed' | 'unknown',
		options?: ErrorOptions,
	) {
		super(message, options);
	}
}

export interface MachineMutationTarget {
	targetId: number;
	fingerprint: string;
}

export interface MachineMutationClaim {
	id: string;
	keys: string[];
	ownerId: string;
	origin: MutationOrigin;
	targets: MachineMutationTarget[];
}

export interface MutationEvidence {
	id: string;
	claimRevision: number;
	outcome: MutationOutcome;
	observedAt: number;
	note: string;
	recordedBy: number;
	createdAt: number;
}

export interface MutationObservation {
	id: string;
	origin: MutationOrigin;
	ownerId: string;
	state: MutationState;
	revision: number;
	createdAt: number;
	blockedAt: number | null;
	releasedAt: number | null;
	targets: MachineMutationTarget[];
	evidence: MutationEvidence[];
}

export interface MutationRecoveryActor {
	userId: number;
	digest: string;
}

export interface MutationEvidenceInput {
	expectedRevision: number;
	outcome: MutationOutcome;
	observedAt: number;
	note: string;
}

export interface MutationReleaseInput {
	expectedRevision: number;
	evidenceId: string;
}

export interface MutationRecoveryView {
	claim: MutationObservation;
	recoveryAllowed: boolean;
}

export type MutationRecoveryTask =
	{ kind: 'evidence'; evidence: MutationEvidence } | { kind: 'release'; evidenceId: string; releasedAt: number };
