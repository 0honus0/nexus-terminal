import type { RemotePermissionCode } from './session-types.js';

export class RemotePermissionError extends Error {
	constructor(readonly code: RemotePermissionCode) {
		super('Remote: ' + code);
	}
}
