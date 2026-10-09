/** Safe to send to untrusted management clients. No SQLite diagnostics or secrets. */
export type TargetErrorCode =
	| 'invalid_input'
	| 'reference_not_found'
	| 'reference_in_use'
	| 'conflict'
	| 'unresolvable'
	| 'storage_unavailable'
	| 'internal_failure';
