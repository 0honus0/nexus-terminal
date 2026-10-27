export class InvalidPayload extends Error {
	constructor() {
		super('invalid_payload');
		this.name = 'InvalidPayload';
	}
}

export function record(input: unknown, keys: readonly string[], maxBytes = 65536): Record<string, unknown> {
	if (!isRecord(input)) {
		throw new InvalidPayload();
	}
	const json = JSON.stringify(input);
	if (
		json === undefined ||
		new TextEncoder().encode(json).byteLength > maxBytes ||
		Object.keys(input).some((key) => !keys.includes(key)) ||
		keys.some((key) => !Object.hasOwn(input, key))
	) {
		throw new InvalidPayload();
	}
	return input;
}

export function integer(input: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
	if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max) {
		throw new InvalidPayload();
	}
	return input;
}

export function text(input: unknown, maxBytes: number): string {
	if (
		typeof input !== 'string' ||
		!input.trim() ||
		new TextEncoder().encode(input).byteLength > maxBytes ||
		new TextDecoder().decode(new TextEncoder().encode(input)) !== input
	) {
		throw new InvalidPayload();
	}
	return input;
}

export function uuid(input: unknown): string {
	if (
		typeof input !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input)
	) {
		throw new InvalidPayload();
	}
	return input.toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
