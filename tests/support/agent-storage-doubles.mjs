/** @returns {Promise<never>} */
async function unexpected() {
	throw new Error('Unexpected storage call in a focused test');
}

/** All members are checked against production storage contracts, including new required methods. */
/**
 * @param {Partial<import('../../packages/backend/src/modules/agent/providers/storage/provider-storage.js').ProviderStorage>} overrides
 * @returns {import('../../packages/backend/src/modules/agent/providers/storage/provider-storage.js').ProviderStorage}
 */
export function providerStorageDouble(overrides = {}) {
	return {
		generation: unexpected,
		recordObservations: unexpected,
		list: unexpected,
		get: unexpected,
		create: unexpected,
		update: unexpected,
		remove: unexpected,
		credential: unexpected,
		snapshot: unexpected,
		...overrides,
	};
}

/**
 * @param {Partial<import('../../packages/backend/src/modules/agent/scope/storage/thread-storage.js').ThreadStorage>} overrides
 * @returns {import('../../packages/backend/src/modules/agent/scope/storage/thread-storage.js').ThreadStorage}
 */
export function threadStorageDouble(overrides = {}) {
	return {
		withState: unexpected,
		forRun: unexpected,
		withAdmission: unexpected,
		list: unexpected,
		mutate: unexpected,
		remove: unexpected,
		...overrides,
	};
}
