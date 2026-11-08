// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createRemoteDesktopController } from '../../../../packages/frontend/src/features/remote-desktop/model/remote-desktop-controller.ts';
import { RemoteDesktopFailure } from '../../../../packages/frontend/src/features/remote-desktop/model/remote-desktop-types.ts';

test('desktop controller fences late tickets and callbacks without replaying unknown attempts', async () => {
	const checks = [];

	const check = (value, name) => {
		if (!value) throw Error(name);
		checks.push(name);
	};

	const ticket = 'A'.repeat(43);
	const wire = {
		ticket,
		protocol: 'VNC',
		host: '127.0.0.1',
		port: 5900,
		username: '',
		password: 'private-password',
	};
	const display = { width: 800, height: 600, dpi: 96 };
	const requests = [];
	const peers = [];
	const attempts = [];
	const states = [];
	const owner = createRemoteDesktopController({
		confirmCertificate: async () => null,

		api: {
			create(_id, _protocol, _display, signal) {
				return new Promise((resolve, reject) => requests.push({ resolve, reject, signal }));
			},
		},

		createPeer(options) {
			const peer = {
				element: document.createElement('div'),
				options,
				closes: 0,
				tickets: [],

				connect(value) {
					this.tickets.push(value.ticket);
				},

				resize() {},

				focus() {},

				setTouchMode() {},

				setTextInputActive() {},

				syncClipboard: async () => {},

				sendText() {},

				close() {
					this.closes++;
				},
			};
			peers.push(peer);
			return peer;
		},

		onState(state, failure) {
			states.push({ state, code: failure?.code });
		},

		onConnected(id) {
			attempts.push({ id });
		},
	});
	const target = { id: 1, name: 'test', type: 'VNC' };
	const input = { hasTouch: false, touchMode: 'direct', mobileInput: null };
	const host = document.createElement('div');
	const first = owner.connect(target, display, input, host);
	const second = owner.connect(target, display, input, host);
	requests[0].resolve(wire);
	await first;
	check(
		requests[0].signal.aborted && peers.length === 0 && attempts.length === 0,
		'late cancelled ticket neither opens nor publishes connection',
	);
	requests[1].resolve({ ...wire, ticket: 'B'.repeat(43) });
	await second;
	check(
		peers.length === 1 && attempts.length === 0 && peers[0].tickets[0] === 'B'.repeat(43),
		'new intent receives only its ticket',
	);
	peers[0].options.onState('connected');
	check(attempts.length === 1 && attempts[0].id === target.id, 'only a connected peer requests metadata refresh');
	owner.close();
	const third = owner.connect(target, display, input, host);
	peers[0].options.onFailure(new RemoteDesktopFailure('remote_unavailable', 'unknown'));
	check(states.at(-1).state === 'connecting', 'old peer callback cannot overwrite new attempt');
	requests[2].reject(new RemoteDesktopFailure('request_failed', 'unknown'));
	await third;
	check(
		requests.length === 3 && peers[0].closes === 1 && states.at(-1).code === 'request_failed',
		'unknown attempt is not automatically replayed',
	);
	owner.close();

	assert.equal(checks.length, 5);
});
