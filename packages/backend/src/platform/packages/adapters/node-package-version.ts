import { readFile } from 'node:fs/promises';

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function readPackageVersion(source: URL): Promise<string> {
	const bytes = await readFile(source);
	if (bytes.byteLength > 128 * 1024) {
		throw new Error('Package metadata exceeds capacity');
	}
	const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	if (!isRecord(value) || typeof value.version !== 'string' || value.version.length > 64) {
		throw new Error('Package version missing');
	}
	return value.version;
}
