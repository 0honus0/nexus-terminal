export interface TargetTagView {
	id: number;
	name: string;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export type TargetTagMutation =
	{ status: 'updated'; value: TargetTagView } | { status: 'not_found' } | { status: 'version_conflict' };
