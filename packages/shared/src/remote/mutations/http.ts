import type { MutationClaimView } from './model.js';
import type { MutationOutcome, MutationErrorCode } from './values.js';

export interface MutationEvidenceRequest {
	expectedRevision: number;
	outcome: MutationOutcome;
	resourcesStopped: true;
	producerStopped: true;
	observedAt: number;
	note: string;
}

export interface MutationReleaseRequest {
	expectedRevision: number;
	evidenceId: string;
	confirmed: true;
}

export interface MutationListQuery {
	after: string | null;
	limit: number;
}

export interface MutationListResponse {
	items: MutationClaimView[];
	nextCursor: string | null;
}

export interface MutationFailureResponse {
	code: MutationErrorCode;
}
