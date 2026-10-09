export interface SshKeySnapshot {
	id: number;
	name: string;
	version: number;
	createdAt: number;
	updatedAt: number;
}
export interface SshKeyInput {
	name: string;
	privateKey: string;
	passphrase?: string | null;
}
export interface SshKeyChanges {
	name?: string;
	privateKey?: string;
	passphrase?: string | null;
}
export interface SshKeyCommand {
	name: string;
	encryptedPrivateKey: string;
	encryptedPassphrase: string | null;
}
export interface SshKeyCommandPatch {
	name?: string;
	encryptedPrivateKey?: string;
	encryptedPassphrase?: string | null;
}
export type SshKeyMutation =
	{ status: 'updated'; value: SshKeySnapshot } | { status: 'not_found' } | { status: 'version_conflict' };
