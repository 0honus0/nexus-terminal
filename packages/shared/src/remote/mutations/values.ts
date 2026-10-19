export const MUTATION_STATES = ['held', 'blocked', 'released'] as const;

export type MutationState = (typeof MUTATION_STATES)[number];

export const MUTATION_ORIGINS = ['files', 'docker', 'agent'] as const;

export type MutationOrigin = (typeof MUTATION_ORIGINS)[number];

export const MUTATION_OUTCOMES = ['applied', 'not_applied', 'partially_applied'] as const;

export type MutationOutcome = (typeof MUTATION_OUTCOMES)[number];

export const MUTATION_ERROR_CODES = [
	'invalid_input',
	'unauthenticated',
	'forbidden',
	'not_found',
	'version_conflict',
	'resource_active',
	'limit_exceeded',
	'storage_unavailable',
	'operation_unknown',
	'shutting_down',
] as const;

export type MutationErrorCode = (typeof MUTATION_ERROR_CODES)[number];

export const MUTATION_ID_MAX_BYTES = 128;

export const MUTATION_NOTE_MAX_BYTES = 1024;

export const MUTATION_BODY_MAX_BYTES = 16 * 1024;

export const MUTATION_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;

export const MUTATION_PAGE_MAX_ITEMS = 50;

export const MUTATION_MAX_EVIDENCE = 16;
