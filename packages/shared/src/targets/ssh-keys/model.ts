export interface TargetSshKeyView {
	id: number;
	name: string;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export type TargetSshKeyMutation =
	{ status: 'updated'; value: TargetSshKeyView } | { status: 'not_found' } | { status: 'version_conflict' };
