import type { MutationClaimView } from '@nexus-terminal/shared/remote/mutations/model';
import type { MutationClaim } from './mutation-types';

export function fromMutation(value: MutationClaimView): MutationClaim {
	return {
		id: value.id,
		origin: value.origin,
		state: value.state,
		revision: value.revision,
		createdAt: value.createdAt,
		blockedAt: value.blockedAt,
		releasedAt: value.releasedAt,
		recoveryAllowed: value.recoveryAllowed,
		targets: value.targets.map((target) => ({ targetId: target.targetId, fingerprint: target.fingerprint })),
		evidence: value.evidence.map((item) => ({
			id: item.id,
			claimRevision: item.claimRevision,
			source: item.source,
			outcome: item.outcome,
			resourcesStopped: item.resourcesStopped,
			producerStopped: item.producerStopped,
			observedAt: item.observedAt,
			note: item.note,
			recordedBy: item.recordedBy,
			createdAt: item.createdAt,
		})),
	};
}
