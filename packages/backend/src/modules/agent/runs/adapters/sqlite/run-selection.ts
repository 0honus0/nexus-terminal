export function readRunSelection(input: unknown): number[] {
	if (typeof input !== 'string') {
		throw new Error('Corrupt Run target selection');
	}
	const value: unknown = JSON.parse(input);
	if (!Array.isArray(value) || new Set(value).size !== value.length) {
		throw new Error('Corrupt Run target selection');
	}
	return value.map((id: unknown) => {
		if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) {
			throw new Error('Corrupt Run target id');
		}
		return id;
	});
}
