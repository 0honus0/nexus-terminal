import { FilesystemFailure } from './filesystem-types';
import { TerminalDirectoryFailure } from './terminal-directory-types';

/** Translate finite application failures; locally authored UI messages remain local. */
export function filesystemFailureMessage(value: unknown, translate: (key: string) => string): string {
	const code =
		value instanceof FilesystemFailure || value instanceof TerminalDirectoryFailure
			? value.code
			: typeof value === 'string'
				? value
				: undefined;
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
	switch (code) {
		case 'not_found':
			return translate('fileManager.errors.notFound');
		case 'forbidden':
			return translate('fileManager.errors.permissionDenied');
		case 'unauthenticated':
			return translate('fileManager.errors.sessionExpired');
		case 'conflict':
			return translate('fileManager.errors.fileConflict');
		case 'stale_target':
			return translate('fileManager.errors.targetChanged');
		case 'host_key_untrusted':
			return translate('fileManager.errors.hostKeyUntrusted');
		case 'remote_unavailable':
			return translate('fileManager.errors.remoteUnavailable');
		case 'invalid_input':
			return translate('fileManager.errors.invalidInput');
		case 'not_text':
			return translate('fileManager.errors.notText');
		case 'command_failed':
			return translate('fileManager.errors.commandFailed');
	}
	return value instanceof Error
		? value.message
		: typeof value === 'string'
			? value
			: translate('fileManager.errors.requestRejected');
}
