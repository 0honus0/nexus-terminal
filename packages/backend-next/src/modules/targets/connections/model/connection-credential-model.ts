import type {
	ConnectionCredentialStorage,
	SshCredentialWrite,
	CredentialMutation as StoredMutation,
} from '../storage/connection-credential-storage.js';
import type { SshCredentialCommand, CredentialMutation } from './connection-credential-types.js';

function toApplicationMutation(result: StoredMutation): CredentialMutation {
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
		const command: SshCredentialWrite =
			value.kind === 'password'
				? { kind: 'password', encryptedPassword: value.encryptedPassword }
				: { kind: 'ssh_key', sshKeyId: value.sshKeyId };
		const result = await this.storage.set(id, version, command);
		return toApplicationMutation(result);
	}

	async clear(id: number, version: number): Promise<CredentialMutation> {
		return toApplicationMutation(await this.storage.clear(id, version));
	}
}
