import type { ComputedRef } from 'vue';
import type { ConnectionRoute, ConnectionType } from '@nexus-terminal/shared/targets/connections/values';
import type { TargetErrorCode } from '@nexus-terminal/shared/targets/values';
import type {
	TargetConnectionInput,
	TargetConnectionChanges,
	TargetImportInput,
	TargetImportItem,
	TargetCredentialInput,
} from '@nexus-terminal/shared/targets/connections/http';

export interface ConnectionSummary {
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
	/** Local observed connection time in milliseconds; never changes server metadata. */
	lastConnectedAt: number | null;
}

export interface ConnectionDraft {
	name: string;
	type: ConnectionType;
	host: string;
	port: number | string;
	username: string;
	authMethod: 'password' | 'key';
	password: string;
	sshKeyId: number | null;
	proxyId: number | null;
	route: ConnectionRoute;
	tagIds: number[];
	notes: string;
	jumpIds: number[];
	remoteApp: string;
	remoteAppDirectory: string;
	remoteAppArguments: string;
}

export interface CredentialSummary {
	connectionId: number;
	version: number;
	credential: { kind: 'none' } | { kind: 'password' } | { kind: 'ssh_key'; sshKeyId: number };
}

export type ConnectionImportReceipt =
	{ index: number; status: 'ok'; id: number } | { index: number; status: 'error'; code: TargetErrorCode };

export type ConnectionSubmission =
	{ kind: 'create'; input: TargetImportInput } | { kind: 'update'; changes: TargetConnectionInput };

export type ConnectionBatchCommand =
	| { kind: 'metadata'; changes: TargetConnectionChanges }
	| { kind: 'credential'; credential: TargetCredentialInput | null };

export interface ConnectionTestSummary {
	success: boolean;
	message: string;
	latencyMs?: number;
}

export interface ConnectionsController {
	connections: ComputedRef<ConnectionSummary[]>;
	loaded: ComputedRef<boolean>;
	busy: ComputedRef<boolean>;
	needsRefresh: ComputedRef<boolean>;
	load(force?: boolean): Promise<ConnectionSummary[]>;
	revalidate(maxAgeMs?: number): Promise<ConnectionSummary[]>;
	refresh(id: number): Promise<ConnectionSummary>;
	markConnected(id: number, timestamp: number): void;
	create(input: TargetImportInput, signal?: AbortSignal): Promise<TargetImportItem[]>;
	importMany(inputs: TargetImportInput[], signal?: AbortSignal): Promise<TargetImportItem[]>;
	update(
		snapshot: ConnectionSummary,
		changes: TargetConnectionChanges,
		signal?: AbortSignal,
	): Promise<ConnectionSummary>;
	remove(id: number, signal?: AbortSignal): Promise<void>;
	clone(id: number, name: string, signal?: AbortSignal): Promise<ConnectionSummary>;
	setCredential(
		snapshot: ConnectionSummary,
		credential: TargetCredentialInput | null,
		signal?: AbortSignal,
	): Promise<void>;
	addTag(ids: number[], tagId: number, signal?: AbortSignal): Promise<void>;
}
