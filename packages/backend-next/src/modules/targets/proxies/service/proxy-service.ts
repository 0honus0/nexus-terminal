import { TargetFailure } from '../../target-failure.js';
import { validateTargetId } from '../../target-validation.js';
import { normalizeProxyChanges, validateProxyMetadata } from '../proxy-rules.js';
import type { ProxyInput, ProxyChanges, ProxySnapshot, ProxyMutation } from '../model/proxy-types.js';
import type { ProxyModel } from '../model/proxy-model.js';
import type { SecretBox } from '../../../../platform/security/secret-box.js';

export class ProxyService {
	constructor(
		private readonly model: ProxyModel,
		private readonly secrets: SecretBox | null,
	) {}

	list(): Promise<ProxySnapshot[]> {
		return this.model.list();
	}

	get(id: number): Promise<ProxySnapshot | null> {
		validateTargetId(id);
		return this.model.get(id);
	}

	create(data: ProxyInput): Promise<ProxySnapshot> {
		const { password, ...metadata } = data;
		const result = validateProxyMetadata(metadata);
		if (password !== undefined && password !== null && !password) {
			throw new TargetFailure('invalid_input');
		}
		return this.model.create({
			...result,
			...(password ? { encryptedPassword: this.requireSecrets().encrypt(password, 'proxy:password') } : {}),
		});
	}

	async update(id: number, version: number, patch: ProxyChanges): Promise<ProxyMutation> {
		validateTargetId(id);
		validateTargetId(version);
		const old = await this.model.get(id);
		if (!old) {
			return { status: 'not_found' };
		}
		const { password, ...fields } = patch;
		if (password === '') {
			throw new TargetFailure('invalid_input');
		}
		const changes = normalizeProxyChanges(old, fields);
		if (password !== undefined) {
			changes.encryptedPassword =
				password === null ? null : this.requireSecrets().encrypt(password, 'proxy:password');
		}
		return this.model.update(id, version, changes);
	}

	delete(id: number): Promise<boolean> {
		validateTargetId(id);
		return this.model.delete(id);
	}

	private requireSecrets(): SecretBox {
		if (!this.secrets) {
			throw new TargetFailure('unresolvable');
		}
		return this.secrets;
	}
}
