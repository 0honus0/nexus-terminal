import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import type { ManagementStorage } from '../storage/management-storage.js';
import type { ManagementActor, ManagementIdentity } from './management-types.js';
import { targetModelFailure } from '../../model/target-technical-failure.js';

export class ManagementModel {
	constructor(
		private readonly storage: ManagementStorage,
		private readonly tokens: SessionTokens,
	) {}

	async withAuthorization(
		actor: ManagementActor,
		admit: (identity: ManagementIdentity) => void,
		work: () => Promise<void>,
	): Promise<void> {
		try {
			await this.storage.withAuthorization(
				{
					sessionDigest: this.tokens.digest(actor.token),

					admit: (userId) => admit({ userId }),
				},
				work,
			);
		} catch (cause) {
			return targetModelFailure(cause);
		}
	}
}
