import type { ConnectionType, ConnectionRoute } from '@nexus-terminal/shared/connections/values';

export interface ConnectionMetadata {
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

export interface ConnectionSnapshot extends ConnectionMetadata {
	id: number;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export type ConnectionMutation =
	{ status: 'updated'; value: ConnectionSnapshot } | { status: 'not_found' } | { status: 'version_conflict' };
