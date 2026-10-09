import type { ConnectionMetadata } from '../model/connection-types.js';
import { ConnectionModel } from '../model/connection-model.js';
import { validId, validateConnection } from './connection-validation.js';

export class ConnectionService {
	constructor(private readonly model: ConnectionModel) {}

	list() {
		return this.model.list();
	}

	get(id: number) {
		validId(id);
		return this.model.get(id);
	}

	create(data: ConnectionMetadata) {
		return this.model.create(validateConnection(data));
	}

	async update(id: number, version: number, changes: Partial<ConnectionMetadata>) {
		validId(id);
		validId(version);
		const old = await this.model.get(id);
		if (!old) return { status: 'not_found' as const };
		const normalized = validateConnection({ ...old, ...changes });
		const update = Object.fromEntries(
			Object.keys(changes).map((key) => [key, normalized[key as keyof ConnectionMetadata]]),
		) as Partial<ConnectionMetadata>;
		return this.model.update(id, version, update);
	}

	clone(id: number, name: string) {
		validId(id);
		if (!name.trim()) throw new Error('Empty name');
		return this.model.clone(id, name.trim());
	}

	delete(id: number) {
		validId(id);
		return this.model.delete(id);
	}

	setTags(id: number, version: number, tags: number[]) {
		validId(id);
		validId(version);
		tags.forEach(validId);
		return this.model.setTags(id, version, tags);
	}

	// TODO: Targets connection testing and post-commit audit; Access/Remote own auth and running sessions.
}
