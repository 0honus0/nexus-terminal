import type { ConnectionType, ConnectionRoute } from './values.js';

export interface TargetConnectionView {
	id: number;
	version: number;
	createdAt: number;
	updatedAt: number;

	name: string;
	type: ConnectionType;
	host: string;
	port: number;
	username: string;
	route: ConnectionRoute;
	proxyId: number | null;
	notes: string | null;
	rdpRemoteApp: string | null;
	rdpRemoteAppDirectory: string | null;
	rdpRemoteAppArguments: string | null;
	tagIds: number[];
	jumpIds: number[];
}

export type TargetConnectionMutation =
	{ status: 'updated'; value: TargetConnectionView } | { status: 'not_found' } | { status: 'version_conflict' };
