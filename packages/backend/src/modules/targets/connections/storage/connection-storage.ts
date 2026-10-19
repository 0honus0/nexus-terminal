import type { ConnectionRoute, ConnectionType } from '@nexus-terminal/shared/targets/connections/values';

export interface StoredCatalogEntry {
	id: number;
	version: number;
	type: ConnectionType;
	name: string;
	host: string;
	port: number;
	username: string;
}

export interface ConnectionData {
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
	jumpIds: number[];
	tagIds: number[];
}

export interface StoredConnection extends ConnectionData {
	id: number;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export type MutationResult =
	{ status: 'updated'; value: StoredConnection } | { status: 'not_found' } | { status: 'version_conflict' };

export interface ConnectionStorage {
	listEntries(ids: number[]): Promise<StoredCatalogEntry[]>;
	list(): Promise<StoredConnection[]>;
	get(id: number): Promise<StoredConnection | null>;
	create(data: ConnectionData): Promise<StoredConnection>;
	update(id: number, expectedVersion: number, changes: Partial<ConnectionData>): Promise<MutationResult>;
	clone(id: number, name: string): Promise<StoredConnection | null>;
	delete(id: number): Promise<boolean>;
	setTags(id: number, expectedVersion: number, tagIds: number[]): Promise<MutationResult>;
}

/** Facts read under the same write transaction; no application objects cross this boundary. */
export interface StoredSshGraphNode {
	id: number;
	type: ConnectionType;
	route: ConnectionRoute;
}

export interface StoredSshGraphEdge {
	connectionId: number;
	position: number;
	jumpConnectionId: number;
}

export interface StoredSshGraphSnapshot {
	nodes: StoredSshGraphNode[];
	edges: StoredSshGraphEdge[];
}

export type ConnectionGraphValidator = (
	connection: ConnectionData,
	graph: StoredSshGraphSnapshot,
	changedId: number,
) => void;

export type ConnectionSnapshotValidator = (
	connections: readonly StoredConnection[],
	graph: StoredSshGraphSnapshot,
) => void;

export interface StoredConnectionTypeChange {
	previousType: ConnectionType;
	nextType: ConnectionType;
	hasCredential: boolean;
	isJumpTarget: boolean;
}

export type ConnectionTypeChangeValidator = (facts: StoredConnectionTypeChange) => void;
