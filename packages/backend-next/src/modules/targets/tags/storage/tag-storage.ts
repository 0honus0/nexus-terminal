import type { SqlExecutor } from '../../../../platform/storage/sqlite/sqlite-runtime.js';
export interface TagRecord {
	id: number;
	name: string;
	version: number;
	createdAt: number;
	updatedAt: number;
}
export type TagMutation =
	{ status: 'updated'; value: TagRecord } | { status: 'not_found' } | { status: 'version_conflict' };
export interface TagStorage {
	list(): Promise<TagRecord[]>;
	get(id: number): Promise<TagRecord | null>;
	create(name: string): Promise<TagRecord>;
	rename(id: number, version: number, name: string): Promise<TagMutation>;
	delete(id: number): Promise<boolean>;
}
export interface TagTransactionStorage {
	findOrCreate(tx: SqlExecutor, name: string): Promise<number>;
}
