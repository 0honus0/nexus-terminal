import type { MutationClaimView } from '@nexus-terminal/shared/remote/mutations/model';
import type { MutationEvidenceRequest, MutationReleaseRequest } from '@nexus-terminal/shared/remote/mutations/http';
import type {
	MutationRecoveryView,
	MutationEvidenceInput,
	MutationReleaseInput,
} from '../../machines/model/mutation-types.js';

export function toMutationEvidence(value: MutationEvidenceRequest): MutationEvidenceInput {
	return {
		expectedRevision: value.expectedRevision,
		outcome: value.outcome,
		observedAt: value.observedAt,
		note: value.note,
	};
}

export function toMutationRelease(value: MutationReleaseRequest): MutationReleaseInput {
	return { expectedRevision: value.expectedRevision, evidenceId: value.evidenceId };
}

export function toMutationView(value: MutationRecoveryView): MutationClaimView {
	const claim = value.claim;
	return {
		id: claim.id,
		origin: claim.origin,
		state: claim.state,
		revision: claim.revision,
		createdAt: claim.createdAt,
		blockedAt: claim.blockedAt,
		releasedAt: claim.releasedAt,
		recoveryAllowed: value.recoveryAllowed,
		targets: claim.targets.map((target) => ({ targetId: target.targetId, fingerprint: target.fingerprint })),
		evidence: claim.evidence.map((e) => ({
			id: e.id,
			claimRevision: e.claimRevision,
			source: 'administrator',
			outcome: e.outcome,
			resourcesStopped: true,
			producerStopped: true,
			observedAt: e.observedAt,
			note: e.note,
			recordedBy: e.recordedBy,
			createdAt: e.createdAt,
		})),
	};
}
