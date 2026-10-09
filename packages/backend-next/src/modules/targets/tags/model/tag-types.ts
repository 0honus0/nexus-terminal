export interface TagSnapshot {
	id: number;
	name: string;
	version: number;
	createdAt: number;
	updatedAt: number;
}
export type TagMutation =
	{ status: 'updated'; value: TagSnapshot } | { status: 'not_found' } | { status: 'version_conflict' };
