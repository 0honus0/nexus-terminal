import type { ConnectionStorage, MutationResult, ConnectionData } from '../storage/connection-storage.js';
import type { ConnectionMetadata, ConnectionMutation } from './connection-types.js';
import { fromStorage, toStorage } from './connection-mapper.js';

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
		const copy: Partial<ConnectionData> = {};
		if (changes.name !== undefined) {
			copy.name = changes.name;
		}
		if (changes.type !== undefined) {
			copy.type = changes.type;
		}
		if (changes.host !== undefined) {
			copy.host = changes.host;
		}
		if (changes.port !== undefined) {
			copy.port = changes.port;
		}
		if (changes.username !== undefined) {
			copy.username = changes.username;
		}
		if (changes.route !== undefined) {
			copy.route = changes.route;
		}
		if (changes.proxyId !== undefined) {
			copy.proxyId = changes.proxyId;
		}
		if (changes.notes !== undefined) {
			copy.notes = changes.notes;
		}
		if (changes.rdpRemoteApp !== undefined) {
			copy.rdpRemoteApp = changes.rdpRemoteApp;
		}
		if (changes.rdpRemoteAppDirectory !== undefined) {
			copy.rdpRemoteAppDirectory = changes.rdpRemoteAppDirectory;
		}
		if (changes.rdpRemoteAppArguments !== undefined) {
			copy.rdpRemoteAppArguments = changes.rdpRemoteAppArguments;
		}
		if (changes.tagIds !== undefined) {
			copy.tagIds = [...changes.tagIds];
		}
		if (changes.jumpIds !== undefined) {
			copy.jumpIds = [...changes.jumpIds];
		}
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
