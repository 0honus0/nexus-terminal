import { TargetFailure } from '../../target-failure.js';
import type { ManagementActor, ManagementIdentity } from '../model/management-types.js';
import type { ManagementModel } from '../model/management-model.js';

function admitAdministrator(identity: ManagementIdentity): void {
	if (identity.userId === null) {
		throw new TargetFailure('unauthenticated');
	}
	if (identity.userId !== 1) {
		throw new TargetFailure('forbidden');
	}
}

export class ManagementService {
	constructor(private readonly model: ManagementModel) {}

	run(actor: ManagementActor, work: () => Promise<void>): Promise<void> {
		if (!actor.token) {
			throw new TargetFailure('unauthenticated');
		}
		admitAdministrator({ userId: actor.userId });
		return this.model.withAuthorization(actor, admitAdministrator, work);
	}
}
