import { validateTagName } from '../tag-rules.js';
import { TARGET_TAG_CONNECTION_MAX_ITEMS } from '@nexus-terminal/shared/targets/tags/values';
import { TargetFailure } from '../../target-failure.js';
import { validateTargetId as validateId } from '../../target-validation.js';
import type { TagModel } from '../model/tag-model.js';
import type { TagConnections, TagSnapshot, TagMutation } from '../model/tag-types.js';

function normalizeConnections(command: TagConnections, allowEmpty: boolean): TagConnections {
	validateId(command.tagId);
	if (
		!Array.isArray(command.connectionIds) ||
		command.connectionIds.length > TARGET_TAG_CONNECTION_MAX_ITEMS ||
		(!allowEmpty && command.connectionIds.length === 0)
	) {
		throw new TargetFailure('invalid_input');
	}
	command.connectionIds.forEach(validateId);
	return { tagId: command.tagId, connectionIds: Array.from(new Set(command.connectionIds)) };
}

export class TagService {
	constructor(private readonly model: TagModel) {}

	list(): Promise<TagSnapshot[]> {
		return this.model.list();
	}

	get(id: number): Promise<TagSnapshot | null> {
		validateId(id);
		return this.model.get(id);
	}

	create(name: string): Promise<TagSnapshot> {
		return this.model.create(validateTagName(name));
	}

	rename(id: number, version: number, name: string): Promise<TagMutation> {
		validateId(id);
		validateId(version);
		return this.model.rename(id, version, validateTagName(name));
	}

	setConnections(command: TagConnections): Promise<boolean> {
		return this.model.setConnections(normalizeConnections(command, true));
	}

	addConnections(command: TagConnections): Promise<boolean> {
		return this.model.addConnections(normalizeConnections(command, false));
	}

	delete(id: number): Promise<boolean> {
		validateId(id);
		return this.model.delete(id);
	}
}
