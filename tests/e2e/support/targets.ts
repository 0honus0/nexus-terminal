import { readConnectionImportResponse } from '../../../packages/shared/src/targets/connections/http-codec';

export function readTestConnectionImportId(input: unknown): number {
	const result = readConnectionImportResponse(input);
	const item = result.items[0];
	if (result.items.length !== 1 || !item || item.status !== 'ok') {
		throw new Error('Expected one successful test connection import');
	}
	return item.id;
}
