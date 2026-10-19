import type { ConnectionType } from '@nexus-terminal/shared/targets/connections/values';

export type ConnectionCredentialWrite =
	{ kind: 'password'; encryptedPassword: string } | { kind: 'ssh_key'; sshKeyId: number };

export type StoredConnectionCredential = ConnectionCredentialWrite & {
	connectionId: number;
	updatedAt: number;
};

export class ConnectionCredentialStorageRefusal extends Error {
	constructor(readonly reason: 'missing_key') {
		super('Credential refused: ' + reason);
		this.name = 'ConnectionCredentialStorageRefusal';
	}
}

export type CredentialMutation = { status: 'updated' } | { status: 'not_found' } | { status: 'version_conflict' };

export interface ConnectionCredentialStorage {
	get(id: number): Promise<StoredCredentialSnapshot | null>;
	set(id: number, expectedVersion: number, value: ConnectionCredentialWrite): Promise<CredentialMutation>;
	clear(id: number, expectedVersion: number): Promise<CredentialMutation>;
}

export type CredentialWriteValidator = (
	connectionType: ConnectionType,
	kind: ConnectionCredentialWrite['kind'] | null,
) => void;

export interface StoredCredentialSnapshot {
	connectionId: number;
	version: number;
	credential: { kind: 'none' } | { kind: 'password' } | { kind: 'ssh_key'; sshKeyId: number };
}
