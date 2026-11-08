import { randomUUID } from 'node:crypto';

export function remoteFixture(closeSession) {
	const id = randomUUID();
	const view = { id, targetId: 7, fingerprint: 'fixture', startedAt: Date.now(), status: 'open' };
	let active = true;
	const dataListeners = new Set();
	const closedListeners = new Set();
	return {
		id,

		emitData(data) {
			for (const listener of dataListeners) {
				listener(data);
			}
		},

		emitEof(reason = 'normal') {
			active = false;
			for (const listener of closedListeners) {
				listener(reason);
			}
		},

		remote: {
			open: async () => view,

			get: () => (active ? view : null),

			list: () => (active ? [view] : []),

			write: () => true,

			resize: () => undefined,

			onData: (_, listener) => {
				dataListeners.add(listener);
				return () => dataListeners.delete(listener);
			},

			onStderr: () => () => undefined,

			onDrain: () => () => undefined,

			onClosed: (_, listener) => {
				closedListeners.add(listener);
				return () => closedListeners.delete(listener);
			},

			pauseOutput: () => undefined,

			resumeOutput: () => undefined,

			closeSession: async () => {
				active = false;
				return closeSession();
			},
		},
	};
}

export const access = {
	authenticate: async (token) => (token === 'good' ? { userId: 1 } : null),
};
