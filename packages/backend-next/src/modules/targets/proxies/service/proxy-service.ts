import type { ProxyMetadata, ProxyInput, ProxyChanges, ProxyCommandPatch } from '../model/proxy-types.js';
import { ProxyModel } from '../model/proxy-model.js';
import type { SecretBox } from '../../../../platform/security/secret-box.js';

function validate(data: ProxyMetadata) {
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

function id(value: number) {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error('Invalid ID');
	}
}

export class ProxyService {
	constructor(
		private readonly model: ProxyModel,
		private readonly secrets: SecretBox | null,
	) {}

	list() {
		return this.model.list();
	}

	get(value: number) {
		id(value);
		return this.model.get(value);
	}

	create(data: ProxyInput) {
		const { password, ...metadata } = data;
		const result = validate(metadata);
		if (password !== undefined && password !== null && !password) {
			throw new Error('Empty proxy password');
		}
		return this.model.create({
			...result,
			...(password ? { encryptedPassword: this.requireSecrets().encrypt(password, 'proxy:password') } : {}),
		});
	}

	async update(value: number, version: number, patch: ProxyChanges) {
		id(value);
		id(version);
		const old = await this.model.get(value);
		if (!old) {
			return { status: 'not_found' as const };
		}
		const { password, ...fields } = patch;
		if (password === '') {
			throw new Error('Empty proxy password');
		}
		const normalized = validate({ ...old, ...fields });
		const changes = Object.fromEntries(
			Object.keys(fields).map((k) => [k, normalized[k as keyof ProxyMetadata]]),
		) as ProxyCommandPatch;
		if (password !== undefined) {
			changes.encryptedPassword =
				password === null ? null : this.requireSecrets().encrypt(password, 'proxy:password');
		}
		return this.model.update(value, version, changes);
	}

	delete(value: number) {
		id(value);
		return this.model.delete(value);
	}

	private requireSecrets() {
		if (!this.secrets) {
			throw new Error('Encryption key required');
		}
		return this.secrets;
	}
}
