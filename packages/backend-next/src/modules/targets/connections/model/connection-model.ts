import type { ConnectionStorage, MutationResult } from '../storage/connection-storage.js';
import type { ConnectionMetadata, ConnectionSnapshot, ConnectionMutation } from './connection-types.js';
import { fromStorage, toStorage, toStoragePatch } from './connection-mapper.js';

function mutation(value: MutationResult): ConnectionMutation {
	if (value.status === 'updated') {
		return { status: 'updated', value: fromStorage(value.value) };
	}
	if (value.status === 'not_found') {
		return { status: 'not_found' };
	}
	return { status: 'version_conflict' };
}

export class ConnectionModel {
	constructor(private readonly storage: Readonly<ConnectionStorage>) {}

	async list(): Promise<ConnectionSnapshot[]> {
		return (await this.storage.list()).map(fromStorage);
	}

	async get(id: number): Promise<ConnectionSnapshot | null> {
		const data = await this.storage.get(id);
		return data ? fromStorage(data) : null;
	}

	async create(data: ConnectionMetadata): Promise<ConnectionSnapshot> {
		return fromStorage(await this.storage.create(toStorage(data)));
	}

	async update(id: number, version: number, changes: Partial<ConnectionMetadata>): Promise<ConnectionMutation> {
		const patch = toStoragePatch(changes);
		return mutation(await this.storage.update(id, version, patch));
	}

	async clone(id: number, name: string): Promise<ConnectionSnapshot | null> {
		const data = await this.storage.clone(id, name);
		return data ? fromStorage(data) : null;
	}

	delete(id: number): Promise<boolean> {
		return this.storage.delete(id);
	}

	async setTags(id: number, version: number, tags: number[]): Promise<ConnectionMutation> {
		return mutation(await this.storage.setTags(id, version, [...tags]));
	}
}
