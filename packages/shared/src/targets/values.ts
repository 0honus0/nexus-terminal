/** Known public Targets error codes; backend diagnostics and secrets never cross wire. */
export const TARGET_ERROR_CODES = [
	'invalid_input',
	'reference_not_found',
	'reference_in_use',
	'conflict',
	'unresolvable',
	'storage_unavailable',
	'internal_failure',
] as const;

export type TargetErrorCode = (typeof TARGET_ERROR_CODES)[number];
