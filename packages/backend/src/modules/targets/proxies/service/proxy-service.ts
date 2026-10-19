import { validateTargetId } from '../../target-validation.js';
import { normalizeProxyChanges, validateProxyMetadata, validateProxyPassword } from '../proxy-rules.js';
import type { ProxyInput, ProxyChanges, ProxySnapshot, ProxyMutation } from '../model/proxy-types.js';
import type { ProxyModel } from '../model/proxy-model.js';

export class ProxyService {
	constructor(private readonly model: ProxyModel) {}

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
		if (password !== undefined && password !== null) {
			validateProxyPassword(password);
		}
		return this.model.create({
			...result,
			...(password ? { password } : {}),
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
		if (password !== undefined && password !== null) {
			validateProxyPassword(password);
		}
		const changes = normalizeProxyChanges(old, fields);
		if (password !== undefined) {
			changes.password = password;
		}
		return this.model.update(id, version, changes);
	}

	delete(id: number): Promise<boolean> {
		validateTargetId(id);
		return this.model.delete(id);
	}
}
