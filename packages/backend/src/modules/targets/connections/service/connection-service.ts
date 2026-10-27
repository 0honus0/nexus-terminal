import { CONNECTION_TYPES, TARGET_CONNECTION_NAME_MAX_BYTES } from '@nexus-terminal/shared/targets/connections/values';
import { TargetFailure } from '../../target-failure.js';
import type {
	ConnectionMetadata,
	ConnectionSnapshot,
	ConnectionMutation,
	ConnectionCatalogEntry,
} from '../model/connection-types.js';
import type { ConnectionModel } from '../model/connection-model.js';
import { validateConnection, normalizeConnectionChanges, validateConnectionTagCount } from '../connection-rules.js';
import { validateTargetId as validateId, validateTargetText } from '../../target-validation.js';

export class ConnectionService {
	constructor(private readonly model: ConnectionModel) {}

	listEntries(ids: number[]): Promise<ConnectionCatalogEntry[]> {
		if (ids.length > 200 || new Set(ids).size !== ids.length) {
			throw new TargetFailure('invalid_input');
		}
		ids.forEach(validateId);
		return this.model.listEntries(ids);
	}

	list(): Promise<ConnectionSnapshot[]> {
		return this.model.list();
	}

	get(id: number): Promise<ConnectionSnapshot | null> {
		validateId(id);
		return this.model.get(id);
	}

	create(data: ConnectionMetadata): Promise<ConnectionSnapshot> {
		return this.model.create(validateConnection(data));
	}

	async update(id: number, version: number, changes: Partial<ConnectionMetadata>): Promise<ConnectionMutation> {
		validateId(id);
		validateId(version);
		const old = await this.model.get(id);
		if (!old) {
			return { status: 'not_found' };
		}
		const update = normalizeConnectionChanges(old, changes);
		return this.model.update(id, version, update);
	}

	clone(id: number, name: string): Promise<ConnectionSnapshot | null> {
		validateId(id);
		const normalized = validateTargetText(name, TARGET_CONNECTION_NAME_MAX_BYTES, false).trim();
		return this.model.clone(id, normalized);
	}

	delete(id: number): Promise<boolean> {
		validateId(id);
		return this.model.delete(id);
	}

	recordConnected(
		id: number,
		version: number,
		createdAt: number,
		type: ConnectionSnapshot['type'],
		timestamp: number,
	): Promise<void> {
		validateId(id);
		validateId(version);
		if (
			!CONNECTION_TYPES.includes(type) ||
			!Number.isSafeInteger(createdAt) ||
			createdAt < 0 ||
			!Number.isSafeInteger(timestamp) ||
			timestamp < createdAt
		) {
			throw new TargetFailure('invalid_input');
		}
		return this.model.recordConnected(id, version, createdAt, type, timestamp);
	}

	setTags(id: number, version: number, tags: number[]): Promise<ConnectionMutation> {
		validateId(id);
		validateId(version);
		validateConnectionTagCount(tags.length);
		tags.forEach(validateId);
		return this.model.setTags(id, version, tags);
	}
}
