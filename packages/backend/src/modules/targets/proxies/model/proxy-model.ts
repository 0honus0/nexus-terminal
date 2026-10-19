import { targetModelFailure, encryptTargetSecret } from '../../model/target-technical-failure.js';
import type { SecretBox } from '../../../../platform/security/secret-box.js';
import type {
	ProxyStorage,
	ProxyRecord,
	ProxyMutation as StoredMutation,
	ProxyPatch,
	ProxyWrite,
} from '../storage/proxy-storage.js';
import type { ProxyInput, ProxyChanges, ProxySnapshot, ProxyMutation } from './proxy-types.js';

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

function toApplicationMutation(result: StoredMutation): ProxyMutation {
	if (result.status === 'updated') {
		return { status: 'updated', value: fromStorage(result.value) };
	}
	if (result.status === 'not_found') {
		return { status: 'not_found' };
	}
	return { status: 'version_conflict' };
}

export class ProxyModel {
	constructor(
		private readonly storage: Readonly<ProxyStorage>,
		private readonly secrets: SecretBox | null,
	) {}

	async list(): Promise<ProxySnapshot[]> {
		return (await this.storage.list().catch(targetModelFailure)).map(fromStorage);
	}

	async get(id: number): Promise<ProxySnapshot | null> {
		const record = await this.storage.get(id).catch(targetModelFailure);
		return record === null ? null : fromStorage(record);
	}

	async create(data: ProxyInput): Promise<ProxySnapshot> {
		const command: ProxyWrite = {
			name: data.name,
			type: data.type,
			host: data.host,
			port: data.port,
			username: data.username,
		};
		if (data.password !== undefined && data.password !== null) {
			command.encryptedPassword = encryptTargetSecret(this.secrets, data.password, 'proxy:password');
		}
		return fromStorage(await this.storage.create(command).catch(targetModelFailure));
	}

	async update(id: number, version: number, data: ProxyChanges): Promise<ProxyMutation> {
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
		if (data.password !== undefined) {
			patch.encryptedPassword =
				data.password === null ? null : encryptTargetSecret(this.secrets, data.password, 'proxy:password');
		}
		return toApplicationMutation(await this.storage.update(id, version, patch).catch(targetModelFailure));
	}

	delete(id: number): Promise<boolean> {
		return this.storage.delete(id).catch(targetModelFailure);
	}
}
