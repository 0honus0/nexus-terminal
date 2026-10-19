import type { MutationState, MutationOrigin, MutationOutcome } from './values.js';

export interface MutationEvidenceView {
	id: string;
	claimRevision: number;
	source: 'administrator';
	outcome: MutationOutcome;
	resourcesStopped: true;
	producerStopped: true;
	observedAt: number;
	note: string;
	recordedBy: number;
	createdAt: number;
}

export interface MutationClaimView {
	id: string;
	origin: MutationOrigin;
	state: MutationState;
	revision: number;
	createdAt: number;
	blockedAt: number | null;
	releasedAt: number | null;
	targets: { targetId: number; fingerprint: string }[];
	/** Requires separate administrator evidence; false for claims belonging to the current live owner. */
	recoveryAllowed: boolean;
	evidence: MutationEvidenceView[];
}
