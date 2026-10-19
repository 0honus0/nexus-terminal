import type { HostDiagnosticErrorCode } from '@nexus-terminal/shared/system/diagnostics/values';

export class SystemOperationError extends Error {
	constructor(readonly code: HostDiagnosticErrorCode) {
		super('System operation failed: ' + code);
		this.name = 'SystemOperationError';
	}
}
