export type ConnectionCredentialInput = { kind: 'password'; password: string } | { kind: 'ssh_key'; sshKeyId: number };

/** Application command after Service encryption; independent of the storage contract. */
export type ConnectionCredentialCommand =
	{ kind: 'password'; encryptedPassword: string } | { kind: 'ssh_key'; sshKeyId: number };

export type CredentialMutation = { status: 'updated' } | { status: 'not_found' } | { status: 'version_conflict' };
