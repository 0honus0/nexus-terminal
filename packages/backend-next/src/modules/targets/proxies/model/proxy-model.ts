import type {
	ProxyStorage,
	ProxyRecord,
	ProxyMutation as StoredMutation,
	ProxyPatch,
	ProxyWrite,
} from '../storage/proxy-storage.js';
import type { ProxyCommand, ProxyCommandPatch, ProxySnapshot, ProxyMutation } from './proxy-types.js';

function fromStorage(record: ProxyRecord): ProxySnapshot {
	return {
		id: record.id,
		name: record.name,
		type: record.type,
		host: record.host,
		port: record.port,
		username: record.username,
		version: record.version,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

function mutation(result: StoredMutation): ProxyMutation {
	if (result.status === 'updated') {
		return { status: 'updated', value: fromStorage(result.value) };
	}
	if (result.status === 'not_found') {
		return { status: 'not_found' };
	}
	return { status: 'version_conflict' };
}

export class ProxyModel {
	constructor(private readonly storage: Readonly<ProxyStorage>) {}

	async list(): Promise<ProxySnapshot[]> {
		return (await this.storage.list()).map(fromStorage);
	}

	async get(id: number): Promise<ProxySnapshot | null> {
		const record = await this.storage.get(id);
		return record === null ? null : fromStorage(record);
	}

	async create(data: ProxyCommand): Promise<ProxySnapshot> {
		const command: ProxyWrite = {
			name: data.name,
			type: data.type,
			host: data.host,
			port: data.port,
			username: data.username,
		};
		if (data.encryptedPassword !== undefined) {
			command.encryptedPassword = data.encryptedPassword;
		}
		return fromStorage(await this.storage.create(command));
	}

	async update(id: number, version: number, data: ProxyCommandPatch): Promise<ProxyMutation> {
		const patch: ProxyPatch = {};
		if (data.name !== undefined) {
			patch.name = data.name;
		}
		if (data.type !== undefined) {
			patch.type = data.type;
		}
		if (data.host !== undefined) {
			patch.host = data.host;
		}
		if (data.port !== undefined) {
			patch.port = data.port;
		}
		if (data.username !== undefined) {
			patch.username = data.username;
		}
		if (data.encryptedPassword !== undefined) {
			patch.encryptedPassword = data.encryptedPassword;
		}
		return mutation(await this.storage.update(id, version, patch));
	}

	delete(id: number) {
		return this.storage.delete(id);
	}
}
