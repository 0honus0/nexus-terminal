import type { ConnectionStorage, MutationResult } from '../storage/connection-storage.js';
import type { ConnectionMetadata, ConnectionMutation } from './connection-types.js';
import { fromStorage, toStorage } from './connection-mapper.js';

function mutation(value: MutationResult): ConnectionMutation {
	return value.status === 'updated' ? { status: 'updated', value: fromStorage(value.value) } : value;
}

export class ConnectionModel {
	constructor(private readonly storage: Readonly<ConnectionStorage>) {}

	async list() {
		return (await this.storage.list()).map(fromStorage);
	}

	async get(id: number) {
		const data = await this.storage.get(id);
		return data ? fromStorage(data) : null;
	}

	async create(data: ConnectionMetadata) {
		return fromStorage(await this.storage.create(toStorage(data)));
	}

	async update(id: number, version: number, changes: Partial<ConnectionMetadata>) {
		const copy = {
			...changes,
			...(changes.tagIds !== undefined ? { tagIds: [...changes.tagIds] } : {}),
			...(changes.jumpIds !== undefined ? { jumpIds: [...changes.jumpIds] } : {}),
		};
		return mutation(await this.storage.update(id, version, copy));
	}

	async clone(id: number, name: string) {
		const data = await this.storage.clone(id, name);
		return data ? fromStorage(data) : null;
	}

	delete(id: number) {
		return this.storage.delete(id);
	}

	async setTags(id: number, version: number, tags: number[]) {
		return mutation(await this.storage.setTags(id, version, [...tags]));
	}
}
