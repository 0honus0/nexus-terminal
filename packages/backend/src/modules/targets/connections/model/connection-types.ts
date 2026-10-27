import type { ConnectionType, ConnectionRoute } from '@nexus-terminal/shared/targets/connections/values';

export interface ConnectionCatalogEntry {
	id: number;
	version: number;
	type: ConnectionType;
	name: string;
	host: string;
	port: number;
	username: string;
}

export interface ConnectionMetadata {
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

export interface ConnectionSnapshot extends ConnectionMetadata {
	id: number;
	version: number;
	createdAt: number;
	updatedAt: number;
	lastConnectedAt: number | null;
}

export type ConnectionMutation =
	{ status: 'updated'; value: ConnectionSnapshot } | { status: 'not_found' } | { status: 'version_conflict' };

export interface ConnectionRelationshipFacts {
	type: ConnectionType;
	route: ConnectionRoute;
	proxyId: number | null;
	jumpIds: number[];
	tagIds: number[];
}

export interface SshGraphNode {
	id: number;
	type: ConnectionType;
	route: ConnectionRoute;
}

export interface SshGraphEdge {
	connectionId: number;
	position: number;
	jumpConnectionId: number;
}

export interface SshGraphSnapshot {
	nodes: SshGraphNode[];
	edges: SshGraphEdge[];
}

export interface ConnectionTypeChange {
	previousType: ConnectionType;
	nextType: ConnectionType;
	hasCredential: boolean;
	isJumpTarget: boolean;
}
