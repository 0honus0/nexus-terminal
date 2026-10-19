import { WORKSPACE_ERROR_CODES } from '@nexus-terminal/shared/remote/workspace/values';
import { FilesystemFailure } from './filesystem-types';

/** Translate finite application failures; locally authored UI messages remain local. */
export function filesystemFailureMessage(value: unknown, translate: (key: string) => string): string {
	const code = value instanceof FilesystemFailure ? value.code : typeof value === 'string' ? value : undefined;
	if (code === 'operation_unknown') {
		return translate('fileManager.errors.operationUnknown');
	}
	if (code === 'not_connected') {
		return translate('fileManager.errors.notConnected');
	}
	if (code === 'protocol_error') {
		return translate('fileManager.errors.invalidResponse');
	}
	if (code === 'limit_exceeded') {
		return translate('fileManager.errors.capacityExceeded');
	}
	if (WORKSPACE_ERROR_CODES.some((known) => known === code)) {
		return translate('fileManager.errors.requestRejected');
	}
	return value instanceof Error
		? value.message
		: typeof value === 'string'
			? value
			: translate('fileManager.errors.requestRejected');
}
