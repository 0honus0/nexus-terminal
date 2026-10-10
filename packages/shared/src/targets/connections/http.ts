import type { ConnectionType, ConnectionRoute } from './values.js';
import type { TargetErrorCode } from '../values.js';

/** Writable connection facts; intentionally independent from the public read view. */
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

export type TargetCredentialMutation = { status: 'updated' } | { status: 'not_found' } | { status: 'version_conflict' };

export type TargetImportItem = { status: 'ok'; id: number } | { status: 'error'; code: TargetErrorCode };

export interface TargetConnectionUpdateRequest {
	version: number;
	changes: TargetConnectionChanges;
}

export interface TargetConnectionTagsRequest {
	version: number;
	tagIds: number[];
}

export interface TargetCredentialSetRequest {
	version: number;
	credential: TargetCredentialInput;
}

export interface TargetCredentialClearRequest {
	version: number;
}

export interface TargetConnectionCloneRequest {
	name: string;
}

/** A batch is also bounded by the complete connections HTTP body budget. */
export interface TargetConnectionImportRequest {
	items: TargetImportInput[];
}

export interface TargetConnectionImportResponse {
	items: TargetImportItem[];
}
