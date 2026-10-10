import type { ProxyType } from '@nexus-terminal/shared/targets/proxies/values';
import type { SqlExecutor } from '../../../../platform/storage/sqlite/sql-types.js';

export interface ProxyData {
	name: string;
	type: ProxyType;
	host: string;
	port: number;
	username: string | null;
}

export interface ProxyRecord extends ProxyData {
	id: number;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface ProxyWrite extends ProxyData {
	encryptedPassword?: string | null;
}

export interface ProxyPatch extends Partial<ProxyData> {
	encryptedPassword?: string | null;
}

export type ProxyMutation =
	{ status: 'updated'; value: ProxyRecord } | { status: 'not_found' } | { status: 'version_conflict' };

export interface ProxyStorage {
	list(): Promise<ProxyRecord[]>;
	get(id: number): Promise<ProxyRecord | null>;
	create(data: ProxyWrite): Promise<ProxyRecord>;
	update(id: number, version: number, patch: ProxyPatch): Promise<ProxyMutation>;
	delete(id: number): Promise<boolean>;
}

export interface ProxyTransactionStorage {
	findOrCreate(tx: SqlExecutor, data: ProxyData): Promise<number>;
}
