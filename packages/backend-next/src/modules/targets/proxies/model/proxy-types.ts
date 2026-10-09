import type { ProxyType } from '@nexus-terminal/shared/proxies/values';

export interface ProxyMetadata {
	name: string;
	type: ProxyType;
	host: string;
	port: number;
	username: string | null;
}

export interface ProxySnapshot extends ProxyMetadata {
	id: number;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface ProxyInput extends ProxyMetadata {
	password?: string | null;
}

export interface ProxyChanges extends Partial<ProxyMetadata> {
	password?: string | null;
}

/** Service has already protected credentials before handing them to Model. */
export interface ProxyCommand extends ProxyMetadata {
	encryptedPassword?: string | null;
}

export interface ProxyCommandPatch extends Partial<ProxyMetadata> {
	encryptedPassword?: string | null;
}

export type ProxyMutation =
	{ status: 'updated'; value: ProxySnapshot } | { status: 'not_found' } | { status: 'version_conflict' };
