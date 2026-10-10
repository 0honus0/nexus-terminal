import type { ProxyType } from './values.js';

export interface TargetProxyInput {
	name: string;
	type: ProxyType;
	host: string;
	port: number;
	username: string | null;
	password?: string | null;
}

export type TargetProxyChanges = Partial<TargetProxyInput>;

export interface TargetProxyUpdateRequest {
	version: number;
	changes: TargetProxyChanges;
}

export interface TargetProxyDeleteResponse {
	deleted: true;
}
