export type SshCredentialWrite =
	{ kind: 'password'; encryptedPassword: string } | { kind: 'ssh_key'; sshKeyId: number };
export type CredentialMutation = { status: 'updated' } | { status: 'not_found' } | { status: 'version_conflict' };
export interface ConnectionCredentialStorage {
	set(id: number, expectedVersion: number, value: SshCredentialWrite): Promise<CredentialMutation>;
	clear(id: number, expectedVersion: number): Promise<CredentialMutation>;
}
