import type { ProxyType } from './values.js';

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

export type TargetProxyMutation =
	{ status: 'updated'; value: TargetProxyView } | { status: 'not_found' } | { status: 'version_conflict' };
