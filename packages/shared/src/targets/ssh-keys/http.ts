export interface TargetSshKeyInput {
	name: string;
	privateKey: string;
	passphrase?: string | null;
}
export type TargetSshKeyChanges = Partial<TargetSshKeyInput>;
export interface TargetSshKeyUpdateRequest {
	version: number;
	changes: TargetSshKeyChanges;
}
export interface TargetSshKeyDeleteResponse {
	deleted: true;
}
