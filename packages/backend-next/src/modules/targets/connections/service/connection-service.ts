import { TargetFailure } from '../../target-failure.js';
import type { ConnectionMetadata, ConnectionSnapshot, ConnectionMutation } from '../model/connection-types.js';
import type { ConnectionModel } from '../model/connection-model.js';
import { validateConnection, normalizeConnectionChanges } from '../connection-rules.js';
import { validateTargetId as validateId } from '../../target-validation.js';

export class ConnectionService {
	constructor(private readonly model: ConnectionModel) {}

	list(): Promise<ConnectionSnapshot[]> {
		return this.model.list();
	}

	get(id: number): Promise<ConnectionSnapshot | null> {
		validateId(id);
		return this.model.get(id);
	}

	create(data: ConnectionMetadata): Promise<ConnectionSnapshot> {
		return this.model.create(validateConnection(data));
	}

	async update(id: number, version: number, changes: Partial<ConnectionMetadata>): Promise<ConnectionMutation> {
		validateId(id);
		validateId(version);
		const old = await this.model.get(id);
		if (!old) {
			return { status: 'not_found' };
		}
		const update = normalizeConnectionChanges(old, changes);
		return this.model.update(id, version, update);
	}

	clone(id: number, name: string): Promise<ConnectionSnapshot | null> {
		validateId(id);
		if (!name.trim()) {
			throw new TargetFailure('invalid_input');
		}
		return this.model.clone(id, name.trim());
	}

	delete(id: number): Promise<boolean> {
		validateId(id);
		return this.model.delete(id);
	}

	setTags(id: number, version: number, tags: number[]): Promise<ConnectionMutation> {
		validateId(id);
		validateId(version);
		tags.forEach(validateId);
		return this.model.setTags(id, version, tags);
	}

	// TODO: Targets connection testing and post-commit audit; Access/Remote own auth and running sessions.
}
