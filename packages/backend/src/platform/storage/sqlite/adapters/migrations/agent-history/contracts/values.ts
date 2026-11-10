// Frozen published database migration dependency. Not an application API.
export const AGENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Individual state / Run event budget. Scope, governance and Provider collections own separate budgets. */
export const AGENT_MAX_RESPONSE_BYTES = 32 * 1024;
