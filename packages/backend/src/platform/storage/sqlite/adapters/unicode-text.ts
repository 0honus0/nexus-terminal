import type { DatabaseSync } from 'node:sqlite';

/** SQLite length/substr stop at NUL; these functions preserve arbitrary valid Unicode text. */
export function installUnicodeTextFunctions(db: DatabaseSync): void {
	db.function('nexus_text_length', { deterministic: true }, (value) => {
		if (typeof value !== 'string') {
			throw new Error('Expected Unicode text');
		}
		let count = 0;
		for (const _point of value) {
			count++;
		}
		return count;
	});
	db.function('nexus_text_slice', { deterministic: true }, (value, offset, limit) => {
		if (
			typeof value !== 'string' ||
			typeof offset !== 'number' ||
			typeof limit !== 'number' ||
			!Number.isSafeInteger(offset) ||
			!Number.isSafeInteger(limit) ||
			offset < 0 ||
			limit < 0
		) {
			throw new Error('Invalid Unicode slice');
		}
		const points: string[] = [];
		let index = 0;
		for (const point of value) {
			if (index >= offset + limit) {
				break;
			}
			if (index >= offset) {
				points.push(point);
			}
			index++;
		}
		return points.join('');
	});
}
