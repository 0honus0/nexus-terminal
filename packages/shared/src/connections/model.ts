import type { ConnectionType, ConnectionRoute } from './values.js';

/** New Targets wire representation; distinct from legacy route:null and jumpChain wire. */
export interface TargetConnectionInput {
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

export interface TargetConnectionView extends TargetConnectionInput {
	id: number;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export type TargetConnectionChanges = Partial<TargetConnectionInput>;

export type TargetCredentialInput = { kind: 'password'; password: string } | { kind: 'ssh_key'; sshKeyId: number };

export interface TargetImportInput {
	connection: TargetConnectionInput;
	inlineProxy?: {
		name: string;
		type: import('../proxies/values.js').ProxyType;
		host: string;
		port: number;
		username: string | null;
	};
	tagNames?: string[];
}
