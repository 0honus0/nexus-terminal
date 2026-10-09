import type { SecretBox } from '../../../../platform/security/secret-box.js';
import type { SshCredentialInput, CredentialMutation } from '../model/connection-credential-types.js';
import type { ConnectionCredentialModel } from '../model/connection-credential-model.js';
export class ConnectionCredentialService {
	constructor(
		private readonly model: ConnectionCredentialModel,
		private readonly secrets: SecretBox | null,
	) {}

	async set(id: number, version: number, input: SshCredentialInput): Promise<CredentialMutation> {
		if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(version) || version <= 0) {
			throw new Error('Invalid ID/version');
		}
		if (input.kind === 'ssh_key') {
			if (!Number.isSafeInteger(input.sshKeyId) || input.sshKeyId <= 0) {
				throw new Error('Invalid SSH key ID');
			}
			return this.model.set(id, version, { kind: 'ssh_key', sshKeyId: input.sshKeyId });
		}
		if (input.kind !== 'password' || !input.password) {
			throw new Error('Invalid SSH password');
		}
		if (!this.secrets) {
			throw new Error('Encryption key required');
		}
		return this.model.set(id, version, {
			kind: 'password',
			encryptedPassword: this.secrets.encrypt(input.password, 'connection:password'),
		});
	}

	clear(id: number, version: number): Promise<CredentialMutation> {
		if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(version) || version <= 0) {
			throw new Error('Invalid ID/version');
		}
		return this.model.clear(id, version);
	}
}
