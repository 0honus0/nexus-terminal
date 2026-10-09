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

export interface TargetProxyView {
	id: number;
	name: string;
	type: ProxyType;
	host: string;
	port: number;
	username: string | null;
	version: number;
	createdAt: number;
	updatedAt: number;
}
