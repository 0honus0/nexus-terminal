import type {
	ProxyMetadata,
	ProxyInput,
	ProxyChanges,
	ProxyCommandPatch,
	ProxySnapshot,
	ProxyMutation,
} from '../model/proxy-types.js';
import type { ProxyModel } from '../model/proxy-model.js';
import type { SecretBox } from '../../../../platform/security/secret-box.js';

function validateProxy(data: ProxyMetadata): ProxyMetadata {
	if (
		!data.name.trim() ||
		!data.host.trim() ||
		!['HTTP', 'SOCKS5'].includes(data.type) ||
		!Number.isInteger(data.port) ||
		data.port < 1 ||
		data.port > 65535
	) {
		throw new Error('Invalid proxy metadata');
	}
	if (data.username !== null && typeof data.username !== 'string') {
		throw new Error('Invalid proxy username');
	}
	return { ...data, name: data.name.trim(), host: data.host.trim() };
}

function normalizeProxyChanges(current: ProxyMetadata, fields: Partial<ProxyMetadata>): ProxyCommandPatch {
	const normalized = validateProxy({ ...current, ...fields });
	const patch: ProxyCommandPatch = {};
	if (fields.name !== undefined) {
		patch.name = normalized.name;
	}
	if (fields.type !== undefined) {
		patch.type = normalized.type;
	}
	if (fields.host !== undefined) {
		patch.host = normalized.host;
	}
	if (fields.port !== undefined) {
		patch.port = normalized.port;
	}
	if (fields.username !== undefined) {
		patch.username = normalized.username;
	}
	return patch;
}

function validateId(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error('Invalid ID');
	}
}

export class ProxyService {
	constructor(
		private readonly model: ProxyModel,
		private readonly secrets: SecretBox | null,
	) {}

	list(): Promise<ProxySnapshot[]> {
		return this.model.list();
	}

	get(id: number): Promise<ProxySnapshot | null> {
		validateId(id);
		return this.model.get(id);
	}

	create(data: ProxyInput): Promise<ProxySnapshot> {
		const { password, ...metadata } = data;
		const result = validateProxy(metadata);
		if (password !== undefined && password !== null && !password) {
			throw new Error('Empty proxy password');
		}
		return this.model.create({
			...result,
			...(password ? { encryptedPassword: this.requireSecrets().encrypt(password, 'proxy:password') } : {}),
		});
	}

	async update(id: number, version: number, patch: ProxyChanges): Promise<ProxyMutation> {
		validateId(id);
		validateId(version);
		const old = await this.model.get(id);
		if (!old) {
			return { status: 'not_found' };
		}
		const { password, ...fields } = patch;
		if (password === '') {
			throw new Error('Empty proxy password');
		}
		const changes = normalizeProxyChanges(old, fields);
		if (password !== undefined) {
			changes.encryptedPassword =
				password === null ? null : this.requireSecrets().encrypt(password, 'proxy:password');
		}
		return this.model.update(id, version, changes);
	}

	delete(id: number): Promise<boolean> {
		validateId(id);
		return this.model.delete(id);
	}

	private requireSecrets(): SecretBox {
		if (!this.secrets) {
			throw new Error('Encryption key required');
		}
		return this.secrets;
	}
}
