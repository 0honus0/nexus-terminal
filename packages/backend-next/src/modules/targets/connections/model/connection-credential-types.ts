export type SshCredentialInput = { kind: 'password'; password: string } | { kind: 'ssh_key'; sshKeyId: number };
/** Application command after Service encryption; independent of the storage contract. */
export type SshCredentialCommand =
	{ kind: 'password'; encryptedPassword: string } | { kind: 'ssh_key'; sshKeyId: number };
export type CredentialMutation = { status: 'updated' } | { status: 'not_found' } | { status: 'version_conflict' };
