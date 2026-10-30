import { validateCredentialAssignment } from '../connection-rules.js';
import { targetModelFailure, encryptTargetSecret } from '../../model/target-technical-failure.js';
import type { SecretBox } from '../../../../platform/security/secret-box.js';
import type {
	ConnectionCredentialStorage,
	ConnectionCredentialWrite,
	CredentialMutation as StoredMutation,
	CredentialWriteValidator,
} from '../storage/connection-credential-storage.js';
import type {
	ConnectionCredentialInput,
	CredentialMutation,
	CredentialSnapshot,
} from './connection-credential-types.js';
import { ConnectionCredentialStorageRefusal } from '../storage/connection-credential-storage.js';
import { TargetFailure } from '../../target-failure.js';

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
	constructor(
		private readonly storage: Readonly<ConnectionCredentialStorage>,
		private readonly secrets: SecretBox | null,
	) {}

	async get(id: number): Promise<CredentialSnapshot | null> {
		const row = await this.storage.get(id).catch(targetModelFailure);
		if (row === null) {
			return null;
		}
		const credential: CredentialSnapshot['credential'] =
			row.credential.kind === 'ssh_key'
				? { kind: 'ssh_key', sshKeyId: row.credential.sshKeyId }
				: { kind: row.credential.kind };
		return { connectionId: row.connectionId, version: row.version, credential };
	}

	async set(id: number, version: number, value: ConnectionCredentialInput): Promise<CredentialMutation> {
		const command = toStoredCredentialWrite(value, this.secrets);
		try {
			return toApplicationMutation(await this.storage.set(id, version, command).catch(targetModelFailure));
		} catch (error) {
			if (error instanceof ConnectionCredentialStorageRefusal) {
				throw new TargetFailure('reference_not_found', {
					cause: error,
				});
			}
			throw error;
		}
	}

	async clear(id: number, version: number): Promise<CredentialMutation> {
		return toApplicationMutation(await this.storage.clear(id, version).catch(targetModelFailure));
	}
}

export const validateStoredCredentialWrite: CredentialWriteValidator = (connectionType, kind) => {
	validateCredentialAssignment({ connectionType, kind });
};

export function toStoredCredentialWrite(
	value: ConnectionCredentialInput,
	secrets: SecretBox | null,
): ConnectionCredentialWrite {
	return value.kind === 'password'
		? { kind: 'password', encryptedPassword: encryptTargetSecret(secrets, value.password, 'connection:password') }
		: { kind: 'ssh_key', sshKeyId: value.sshKeyId };
}
