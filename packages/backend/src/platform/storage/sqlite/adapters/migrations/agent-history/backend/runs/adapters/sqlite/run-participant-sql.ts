// Frozen published database migration dependency. Not an application API.
export function storedInteger(value: unknown, minimum = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
		throw new Error('Corrupt collaboration integer');
	}
	return value;
}

export function assertRunRevisionAvailable(value: unknown, increments = 1): void {
	if (storedInteger(value) > Number.MAX_SAFE_INTEGER - increments) {
		throw new Error('Agent Run revision exhausted');
	}
}

export function storedText(value: unknown): string {
	if (typeof value !== 'string') {
		throw new Error('Corrupt collaboration text');
	}
	return value;
}
