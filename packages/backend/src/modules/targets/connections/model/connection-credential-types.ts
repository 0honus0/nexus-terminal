import type { ConnectionType } from '@nexus-terminal/shared/targets/connections/values';

export type ConnectionCredentialInput = { kind: 'password'; password: string } | { kind: 'ssh_key'; sshKeyId: number };

export type CredentialMutation = { status: 'updated' } | { status: 'not_found' } | { status: 'version_conflict' };

export interface CredentialAssignment {
	connectionType: ConnectionType;
	kind: ConnectionCredentialInput['kind'] | null;
}

export type CredentialState = { kind: 'none' } | { kind: 'password' } | { kind: 'ssh_key'; sshKeyId: number };

export interface CredentialSnapshot {
	connectionId: number;
	version: number;
	credential: CredentialState;
}
