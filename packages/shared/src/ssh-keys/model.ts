export interface TargetSshKeyInput {
	name: string;
	privateKey: string;
	passphrase?: string | null;
}

export type TargetSshKeyChanges = Partial<TargetSshKeyInput>;

export interface TargetSshKeyView {
	id: number;
	name: string;
	version: number;
	createdAt: number;
	updatedAt: number;
}
