import { targetModelFailure } from '../../model/target-technical-failure.js';
import type { TagStorage, TagRecord, TagMutation as StoredMutation } from '../storage/tag-storage.js';
import type { TagConnections, TagSnapshot, TagMutation } from './tag-types.js';
import { ConnectionTagStorageRefusal } from '../../connections/storage/connection-tag-storage.js';
import { validateConnectionTagCount } from '../../connections/connection-rules.js';
import { TargetFailure } from '../../target-failure.js';

function fromStorage(record: TagRecord): TagSnapshot {
	return {
		id: record.id,
		name: record.name,
		version: record.version,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

function toApplicationMutation(result: StoredMutation): TagMutation {
	if (result.status === 'updated') {
		return { status: 'updated', value: fromStorage(result.value) };
	}
	if (result.status === 'not_found') {
		return { status: 'not_found' };
	}
	return { status: 'version_conflict' };
}

function tagAssociationFailure(cause: unknown): never {
	if (cause instanceof ConnectionTagStorageRefusal) {
		throw new TargetFailure('reference_not_found', { cause });
	}
	return targetModelFailure(cause);
}

export class TagModel {
	constructor(private readonly storage: Readonly<TagStorage>) {}

	async list(): Promise<TagSnapshot[]> {
		return (await this.storage.list().catch(targetModelFailure)).map(fromStorage);
	}

	async get(id: number): Promise<TagSnapshot | null> {
		const record = await this.storage.get(id).catch(targetModelFailure);
		return record === null ? null : fromStorage(record);
	}

	async create(name: string): Promise<TagSnapshot> {
		return fromStorage(await this.storage.create(name).catch(targetModelFailure));
	}

	async rename(id: number, version: number, name: string): Promise<TagMutation> {
		return toApplicationMutation(await this.storage.rename(id, version, name).catch(targetModelFailure));
	}

	setConnections(command: TagConnections): Promise<boolean> {
		return this.storage
			.setConnections({ tagId: command.tagId, connectionIds: command.connectionIds.map((id) => id) }, (count) =>
				validateConnectionTagCount(count),
			)
			.catch(tagAssociationFailure);
	}

	addConnections(command: TagConnections): Promise<boolean> {
		return this.storage
			.addConnections({ tagId: command.tagId, connectionIds: command.connectionIds.map((id) => id) }, (count) =>
				validateConnectionTagCount(count),
			)
			.catch(tagAssociationFailure);
	}

	delete(id: number): Promise<boolean> {
		return this.storage.delete(id).catch(targetModelFailure);
	}
}
