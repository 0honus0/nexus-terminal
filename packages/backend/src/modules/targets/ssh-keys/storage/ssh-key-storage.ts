export interface SshKeySummary {
	id: number;
	name: string;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export type SshKeyMutation =
	{ status: 'updated'; value: SshKeySummary } | { status: 'not_found' } | { status: 'version_conflict' };

export interface SshKeyWrite {
	name: string;
	encryptedPrivateKey: string;
	encryptedPassphrase: string | null;
}

export interface SshKeyPatch {
	name?: string;
	encryptedPrivateKey?: string;
	encryptedPassphrase?: string | null;
}

export interface SshKeyStorage {
	list(): Promise<SshKeySummary[]>;
	get(id: number): Promise<SshKeySummary | null>;
	create(data: SshKeyWrite): Promise<SshKeySummary>;
	update(id: number, version: number, patch: SshKeyPatch): Promise<SshKeyMutation>;
	delete(id: number): Promise<boolean>;
}
