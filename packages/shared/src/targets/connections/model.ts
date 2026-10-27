import type { ConnectionType, ConnectionRoute } from './values.js';

export interface TargetConnectionView {
	id: number;
	version: number;
	createdAt: number;
	updatedAt: number;
	lastConnectedAt: number | null;

	name: string;
	type: ConnectionType;
	host: string;
	port: number;
	username: string;
	route: ConnectionRoute;
	proxyId: number | null;
	notes: string | null;
	tagIds: number[];
	jumpIds: number[];
}

export type TargetConnectionMutation =
	{ status: 'updated'; value: TargetConnectionView } | { status: 'not_found' } | { status: 'version_conflict' };

export type TargetCredentialState = { kind: 'none' } | { kind: 'password' } | { kind: 'ssh_key'; sshKeyId: number };

export interface TargetCredentialView {
	connectionId: number;
	version: number;
	credential: TargetCredentialState;
}
