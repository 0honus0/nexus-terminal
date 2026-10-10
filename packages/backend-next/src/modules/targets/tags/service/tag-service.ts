import { TargetFailure } from '../../target-failure.js';
import { validateTargetId as validateId } from '../../target-validation.js';
import type { TagModel } from '../model/tag-model.js';
import type { TagSnapshot, TagMutation } from '../model/tag-types.js';

function validateName(value: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new TargetFailure('invalid_input');
	}
	return value.trim();
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
		return this.model.create(validateName(name));
	}

	rename(id: number, version: number, name: string): Promise<TagMutation> {
		validateId(id);
		validateId(version);
		return this.model.rename(id, version, validateName(name));
	}

	delete(id: number): Promise<boolean> {
		validateId(id);
		return this.model.delete(id);
	}
}
