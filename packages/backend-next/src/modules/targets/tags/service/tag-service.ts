import type { TagModel } from '../model/tag-model.js';
import type { TagSnapshot, TagMutation } from '../model/tag-types.js';

function validateId(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error('Invalid ID');
	}
}

function validateName(value: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error('Invalid tag name');
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
