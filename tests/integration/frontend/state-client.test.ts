import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { StateClient } from '../../../src/state/browser/state-api.js';

const socket = vi.hoisted(() => ({
	send: vi.fn(() => true),
	close: vi.fn(),
	options: undefined as undefined | { onMessage(socket: unknown, event: { data: string }): void },
}));
vi.mock('@vueuse/core', () => ({
	useWebSocket(_url: string, options: NonNullable<typeof socket.options>) {
		socket.options = options;
		return {
			...socket,
			status: { value: 'OPEN' },

			open() {},
		};
	},
}));
const topic = { name: 'fixture' };
const instanceId = 'c5f90d25-9415-4ff0-ac54-a8449500dc8b';

const frame = (data: object) =>
	socket.options!.onMessage(null, { data: JSON.stringify({ topic, instanceId, ...data }) });

const snapshot = (state: unknown, revision = 0) => frame({ type: 'snapshot', state, revision });

afterEach(() => vi.useRealTimers());

it('isolates the patch baseline from observer mutations', () => {
	const client = new StateClient({
		log: { report() {} },

		onSessionExpired() {},
	});
	try {
		const observed: unknown[] = [];
		client.subscribe(topic, z.unknown(), {
			updated(value) {
				observed.push(structuredClone(value));
				(value as { untouched: number }).untouched = 999;
			},

			unconfirmed() {},
		});
		snapshot({ untouched: 1, changed: 0 });
		frame({
			type: 'patch',
			baseRevision: 0,
			revision: 1,
			changes: [{ op: 'replace', path: '/changed', value: 1 }],
		});
		expect(observed).toEqual([
			{ untouched: 1, changed: 0 },
			{ untouched: 1, changed: 1 },
		]);
	} finally {
		client.close();
	}
});

it('does not send a resync or delayed retry after the observer unsubscribes', () => {
	vi.useFakeTimers();
	const client = new StateClient({
		log: { report() {} },

		onSessionExpired() {},
	});
	try {
		let calls = 0;
		const release = client.subscribe(topic, z.number(), {
			updated() {},

			unconfirmed() {
				if (++calls === 2) release();
			},
		});
		snapshot('invalid');
		snapshot('still invalid');
		const count = socket.send.mock.calls.length;
		vi.advanceTimersByTime(1000);
		expect(socket.send).toHaveBeenCalledTimes(count);
	} finally {
		client.close();
	}
});
