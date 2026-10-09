import type { TagStorage, TagRecord, TagMutation as StoredMutation } from '../storage/tag-storage.js';
import type { TagSnapshot, TagMutation } from './tag-types.js';

function fromStorage(record: TagRecord): TagSnapshot {
	return {
		id: record.id,
		name: record.name,
		version: record.version,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

function mutation(result: StoredMutation): TagMutation {
	if (result.status === 'updated') return { status: 'updated', value: fromStorage(result.value) };
	if (result.status === 'not_found') return { status: 'not_found' };
	return { status: 'version_conflict' };
}

export class TagModel {
	constructor(private readonly storage: Readonly<TagStorage>) {}

	async list(): Promise<TagSnapshot[]> {
		return (await this.storage.list()).map(fromStorage);
	}

	async get(id: number): Promise<TagSnapshot | null> {
		const record = await this.storage.get(id);
		return record === null ? null : fromStorage(record);
	}

	async create(name: string): Promise<TagSnapshot> {
		return fromStorage(await this.storage.create(name));
	}

	async rename(id: number, version: number, name: string): Promise<TagMutation> {
		return mutation(await this.storage.rename(id, version, name));
	}

	delete(id: number) {
		return this.storage.delete(id);
	}
}
