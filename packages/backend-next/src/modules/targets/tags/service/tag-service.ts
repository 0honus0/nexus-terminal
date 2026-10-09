import { TagModel } from '../model/tag-model.js';

function id(value: number) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid ID');
}

function name(value: string) {
	if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid tag name');
	return value.trim();
}

export class TagService {
	constructor(private readonly model: TagModel) {}

	list() {
		return this.model.list();
	}

	get(value: number) {
		id(value);
		return this.model.get(value);
	}

	create(value: string) {
		return this.model.create(name(value));
	}

	rename(value: number, version: number, next: string) {
		id(value);
		id(version);
		return this.model.rename(value, version, name(next));
	}

	delete(value: number) {
		id(value);
		return this.model.delete(value);
	}
}
