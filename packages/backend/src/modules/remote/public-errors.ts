export { RemoteOperationError } from './remote-errors.js';

export type MachineMutationAdmissionCode = 'mutation_busy' | 'mutation_blocked';

/** Backend machine operation failures expose neither resource handles nor technical diagnostics. */
export class RemoteMachineOperationError extends Error {
	constructor(
		readonly code:
			| import('@nexus-terminal/shared/remote/files/values').RemoteFileErrorCode
			| 'cleanup_failed'
			| 'command_failed'
			| MachineMutationAdmissionCode,
	) {
		super('Remote machine operation failed: ' + code);
		this.name = 'RemoteMachineOperationError';
	}
}
