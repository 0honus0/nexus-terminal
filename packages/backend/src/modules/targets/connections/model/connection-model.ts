import { targetModelFailure } from '../../model/target-technical-failure.js';
import { validateConnectionGraph, validateConnectionSnapshot } from '../ssh-graph-rules.js';
import { validateConnectionTypeChange, validateConnection } from '../connection-rules.js';
import type {
	ConnectionStorage,
	MutationResult,
	ConnectionGraphValidator,
	ConnectionSnapshotValidator,
	ConnectionTypeChangeValidator,
} from '../storage/connection-storage.js';
import type {
	ConnectionMetadata,
	ConnectionSnapshot,
	ConnectionMutation,
	ConnectionCatalogEntry,
} from './connection-types.js';
import {
	fromStorage,
	toStorage,
	toStoragePatch,
	fromStoredRelationships,
	fromStoredGraph,
} from './connection-mapper.js';

export const validateStoredConnectionSnapshot: ConnectionSnapshotValidator = (connections, snapshot) => {
	for (const connection of connections) {
		validateConnection(fromStorage(connection));
	}
	validateConnectionSnapshot(connections.map(fromStoredRelationships), fromStoredGraph(snapshot));
};

function toApplicationMutation(value: MutationResult): ConnectionMutation {
	if (value.status === 'updated') {
		return { status: 'updated', value: fromStorage(value.value) };
	}
	if (value.status === 'not_found') {
		return { status: 'not_found' };
	}
	return { status: 'version_conflict' };
}

/** Bridge storage snapshots to application facts before running a pure business rule. */
export const validateStoredConnectionGraph: ConnectionGraphValidator = (connection, snapshot, changedId) => {
	validateConnectionGraph(fromStoredRelationships(connection), fromStoredGraph(snapshot), changedId);
};

export class ConnectionModel {
	constructor(private readonly storage: Readonly<ConnectionStorage>) {}

	async listEntries(ids: number[]): Promise<ConnectionCatalogEntry[]> {
		return (await this.storage.listEntries(ids.map((id) => id)).catch(targetModelFailure)).map((row) => ({
			id: row.id,
			version: row.version,
			type: row.type,
			name: row.name,
			host: row.host,
			port: row.port,
			username: row.username,
		}));
	}

	async list(): Promise<ConnectionSnapshot[]> {
		return (await this.storage.list().catch(targetModelFailure)).map(fromStorage);
	}

	async get(id: number): Promise<ConnectionSnapshot | null> {
		const data = await this.storage.get(id).catch(targetModelFailure);
		return data ? fromStorage(data) : null;
	}

	async create(data: ConnectionMetadata): Promise<ConnectionSnapshot> {
		return fromStorage(await this.storage.create(toStorage(data)).catch(targetModelFailure));
	}

	async update(id: number, version: number, changes: Partial<ConnectionMetadata>): Promise<ConnectionMutation> {
		const patch = toStoragePatch(changes);
		return toApplicationMutation(await this.storage.update(id, version, patch).catch(targetModelFailure));
	}

	async clone(id: number, name: string): Promise<ConnectionSnapshot | null> {
		const data = await this.storage.clone(id, name).catch(targetModelFailure);
		return data ? fromStorage(data) : null;
	}

	delete(id: number): Promise<boolean> {
		return this.storage.delete(id).catch(targetModelFailure);
	}

	recordConnected(
		id: number,
		version: number,
		createdAt: number,
		type: ConnectionSnapshot['type'],
		timestamp: number,
	): Promise<void> {
		return this.storage.recordConnected(id, version, createdAt, type, timestamp).catch(targetModelFailure);
	}

	async setTags(id: number, version: number, tags: number[]): Promise<ConnectionMutation> {
		return toApplicationMutation(await this.storage.setTags(id, version, [...tags]).catch(targetModelFailure));
	}
}

export const validateStoredConnectionTypeChange: ConnectionTypeChangeValidator = (facts) => {
	validateConnectionTypeChange({
		previousType: facts.previousType,
		nextType: facts.nextType,
		hasCredential: facts.hasCredential,
		isJumpTarget: facts.isJumpTarget,
	});
};
