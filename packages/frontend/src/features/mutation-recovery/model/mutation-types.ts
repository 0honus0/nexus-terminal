import type {
	MutationOrigin,
	MutationState,
	MutationOutcome,
	MutationErrorCode,
} from '@nexus-terminal/shared/remote/mutations/values';
import type { HttpRequestFailureCode, RequestOutcome } from '@/client/http/request-failure';

export interface MutationEvidence {
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

export interface MutationClaim {
	id: string;
	origin: MutationOrigin;
	state: MutationState;
	revision: number;
	createdAt: number;
	blockedAt: number | null;
	releasedAt: number | null;
	targets: { targetId: number; fingerprint: string }[];
	recoveryAllowed: boolean;
	evidence: MutationEvidence[];
}

export interface EvidenceInput {
	expectedRevision: number;
	outcome: MutationOutcome;
	resourcesStopped: boolean;
	producerStopped: boolean;
	observedAt: number;
	note: string;
}

export interface MutationPage {
	items: MutationClaim[];
	nextCursor: string | null;
}

export class MutationRequestFailure extends Error {
	constructor(
		readonly code: MutationErrorCode | HttpRequestFailureCode | 'refresh_required',
		readonly outcome: RequestOutcome,
		options?: ErrorOptions,
	) {
		super('Mutation recovery request failed', options);
		this.name = 'MutationRequestFailure';
	}
}
