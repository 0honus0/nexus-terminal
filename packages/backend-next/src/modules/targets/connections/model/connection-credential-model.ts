import type {
	ConnectionCredentialStorage,
	CredentialMutation as StoredMutation,
} from '../storage/connection-credential-storage.js';
import type { SshCredentialCommand, CredentialMutation } from './connection-credential-types.js';

function mutation(result: StoredMutation): CredentialMutation {
	if (result.status === 'updated') {
		return { status: 'updated' };
	}
	if (result.status === 'not_found') {
		return { status: 'not_found' };
	}
	return { status: 'version_conflict' };
}

export class ConnectionCredentialModel {
	constructor(private readonly storage: Readonly<ConnectionCredentialStorage>) {}

	async set(id: number, version: number, value: SshCredentialCommand): Promise<CredentialMutation> {
		return mutation(
			await this.storage.set(
				id,
				version,
				value.kind === 'password'
					? { kind: 'password', encryptedPassword: value.encryptedPassword }
					: { kind: 'ssh_key', sshKeyId: value.sshKeyId },
			),
		);
	}

	async clear(id: number, version: number): Promise<CredentialMutation> {
		return mutation(await this.storage.clear(id, version));
	}
}
