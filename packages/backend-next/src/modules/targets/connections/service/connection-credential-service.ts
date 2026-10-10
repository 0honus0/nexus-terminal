import { TargetFailure } from '../../target-failure.js';
import { validateTargetId } from '../../target-validation.js';
import type { SecretBox } from '../../../../platform/security/secret-box.js';
import type { SshCredentialInput, CredentialMutation } from '../model/connection-credential-types.js';
import type { ConnectionCredentialModel } from '../model/connection-credential-model.js';

export class ConnectionCredentialService {
	constructor(
		private readonly model: ConnectionCredentialModel,
		private readonly secrets: SecretBox | null,
	) {}

	async set(id: number, version: number, input: SshCredentialInput): Promise<CredentialMutation> {
		validateTargetId(id);
		validateTargetId(version);
		if (input.kind === 'ssh_key') {
			validateTargetId(input.sshKeyId);
			return this.model.set(id, version, { kind: 'ssh_key', sshKeyId: input.sshKeyId });
		}
		if (input.kind !== 'password' || !input.password) {
			throw new TargetFailure('invalid_input');
		}
		if (!this.secrets) {
			throw new TargetFailure('unresolvable');
		}
		return this.model.set(id, version, {
			kind: 'password',
			encryptedPassword: this.secrets.encrypt(input.password, 'connection:password'),
		});
	}

	clear(id: number, version: number): Promise<CredentialMutation> {
		validateTargetId(id);
		validateTargetId(version);
		return this.model.clear(id, version);
	}
}
