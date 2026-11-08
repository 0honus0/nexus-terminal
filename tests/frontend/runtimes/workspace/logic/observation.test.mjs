// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { test, vi, afterEach } from 'vitest';
import WebSocket from '../../../../../packages/backend/node_modules/ws/index.js';
import { openWorkspacePeer } from '../../../../support/protocols/workspace-peer.mjs';

afterEach(() => vi.unstubAllGlobals());

test('observation adapters and controllers preserve lifecycle, sample history and unknown Docker writes', async () => {
	const peer = await openWorkspacePeer();
	const producer = peer.server;
	const calls = [];
	const timers = new Set();
	const stats = {
		id: 'abcdef012345',
		name: 'fixture',
		cpuPercent: '0%',
		memoryUsage: '1MiB / 1GiB',
		memoryPercent: '0.1%',
		networkIo: '0B / 0B',
		blockIo: '0B / 0B',
		pids: '1',
	};
	const container = {
		id: 'abcdef0123456789',
		names: ['fixture'],
		image: 'alpine',
		imageId: 'sha256:example',
		command: 'sh',
		created: '2026-10-18',
		state: 'running',
		status: 'Up',
		ports: [{ privatePort: 80, type: 'tcp' }],
		labels: 'fixture=yes',
		stats,
	};
	producer.on('connection', (socket) => {
		let mode = 'normal';
		socket.on('message', (raw) => {
			const request = JSON.parse(raw.toString());
			calls.push({ mode, ...request });
			if (!request.requestId) {
				return;
			}

			const reply = (data) =>
				socket.readyState === WebSocket.OPEN &&
				socket.send(
					JSON.stringify({ type: 'response', requestId: request.requestId, payload: { ok: true, data } }),
				);

			const emit = (type, payload) => socket.send(JSON.stringify({ type, payload }));

			if (request.type === 'fixture.mode') {
				mode = request.payload.mode;
				reply(null);
			} else if (request.type === 'status.start') {
				const task = () => {
					if (socket.readyState !== WebSocket.OPEN) {
						return;
					}
					emit('status.sample', { timestamp: 1700000000000, cpuPercent: 0 });
					reply(null);
				};

				if (mode === 'late-start') {
					const timer = setTimeout(() => {
						timers.delete(timer);
						task();
					}, 80);
					timers.add(timer);
				} else {
					task();
				}
			} else if (request.type === 'fixture.sample') {
				emit('status.sample', request.payload);
				reply(null);
			} else if (request.type === 'docker.status') {
				reply({
					available: true,
					containers: [mode === 'bad-id' ? { ...container, id: 'x;touch /tmp/never' } : container],
				});
			} else if (request.type === 'docker.stats') {
				reply(mode === 'foreign-stats' ? { ...stats, id: 'foreign', name: 'foreign' } : stats);
			} else if (request.type === 'docker.command' && mode === 'lost-command') {
				socket.close(4000, 'Controlled lost receipt');
			} else if (request.type === 'docker.command' && mode === 'bad-command') {
				reply({ privateField: 'not-null' });
			} else {
				reply(null);
			}
		});
	});
	try {
		vi.stubGlobal('WebSocket', peer.WebSocket);
		const { createPinia, setActivePinia } = await import('pinia');
		setActivePinia(createPinia());
		const { WorkspaceSocket } =
			await import('../../../../../packages/frontend/src/runtimes/workspace/protocol/workspaceSocket.ts');
		const { createStatusChannel, createDockerChannel } =
			await import('../../../../../packages/frontend/src/runtimes/workspace/adapters/observation-adapters.ts');
		const { createStatusMonitorSession } =
			await import('../../../../../packages/frontend/src/features/status-monitor/composables/useStatusMonitor.ts');
		const { createDockerSession } =
			await import('../../../../../packages/frontend/src/features/docker/composables/useDocker.ts');
		const { DockerFailure } =
			await import('../../../../../packages/frontend/src/features/docker/model/docker-types.ts');
		const { formatStatusRate } =
			await import('../../../../../packages/frontend/src/features/status-monitor/model/statusFormatting.ts');
		const sockets = [],
			controllers = [],
			results = [];

		const expect = (value, name) => {
			if (!value) {
				throw Error(name);
			}
			results.push(name);
		};

		const wait = async (check) => {
			const end = performance.now() + 5000;
			while (!check()) {
				if (performance.now() > end) {
					throw Error('Observation condition timeout');
				}
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		};

		const deferred = () => {
			let resolve, reject;
			const promise = new Promise((ok, no) => {
				resolve = ok;
				reject = no;
			});
			return { promise, resolve, reject };
		};

		const rejection = async (task) => {
			try {
				await task;
				return undefined;
			} catch (error) {
				return error;
			}
		};

		const makeSocket = async () => {
			const socket = new WorkspaceSocket();
			sockets.push(socket);
			await socket.open();
			return socket;
		};

		try {
			const socket = await makeSocket();
			let bound = false;
			const docker = createDockerChannel(socket, () => bound);
			expect(
				(await rejection(docker.command('abc', 'start')))?.outcome === 'not_dispatched',
				'ACK gate rejects before dispatch',
			);
			bound = true;
			expect(
				(await docker.getStatus()).containers[0].stats.id === 'abcdef012345',
				'strict status maps shortened native stats',
			);
			expect(
				(await docker.getStats('abcdef0123456789')).id === 'abcdef012345',
				'stats checks original full/short id',
			);
			await socket.requestConnected('fixture.mode', { mode: 'foreign-stats' });
			expect(
				(await rejection(docker.getStats('abcdef0123456789')))?.code === 'protocol_failure',
				'foreign stats rejected',
			);
			await socket.requestConnected('fixture.mode', { mode: 'bad-id' });
			expect(
				(await rejection(docker.getStatus()))?.code === 'protocol_failure',
				'unsafe ID never reaches terminal command',
			);
			await socket.requestConnected('fixture.mode', { mode: 'bad-command' });
			expect(
				(await rejection(docker.command('abc', 'restart')))?.outcome === 'unknown',
				'malformed mutation receipt is unknown',
			);
			await socket.requestConnected('fixture.mode', { mode: 'lost-command' });
			expect(
				(await rejection(docker.command('abc', 'restart')))?.outcome === 'unknown',
				'lost command receipt is unknown',
			);
			expect(!socket.connected, 'lost receipt does not open replacement socket');
			const statusSocket = await makeSocket();
			let live = true;
			const statusAdapter = createStatusChannel(statusSocket, () => live);
			const monitor = createStatusMonitorSession(statusAdapter);
			controllers.push(monitor);
			monitor.activate();
			await monitor.workspaceConnected();
			await wait(() => monitor.current.value !== null);
			expect(monitor.history.value.cpu[0].value === 0, 'real zero sample retained');
			expect(
				monitor.history.value.networkRx.length === 0 && monitor.history.value.memory.length === 0,
				'missing measurements never become zero history',
			);
			expect(
				formatStatusRate() === '—' && formatStatusRate(0) === '0 B/s',
				'missing rate differs from actual zero',
			);
			monitor.deactivate();
			await new Promise((resolve) => setTimeout(resolve, 30));
			const count = monitor.history.value.cpu.length;
			await statusSocket.requestConnected('fixture.sample', { timestamp: 1700000001000, cpuPercent: 15 });
			expect(
				monitor.history.value.cpu.length === count + 1,
				'short tab switches retain the live sample baseline',
			);
			live = false;
			statusAdapter.disconnect();
			monitor.workspaceDisconnected();
			expect(
				monitor.current.value === null && monitor.history.value.cpu.length === 0,
				'disconnect clears old target snapshot',
			);
			statusSocket.close();
			await statusSocket.open();
			live = true;
			monitor.activate();
			await monitor.workspaceConnected();
			await wait(() => monitor.current.value !== null);
			expect(monitor.history.value.cpu.length === 1, 'new attachment receives only new history');
			const binding = createStatusChannel(statusSocket, () => true);
			await statusSocket.requestConnected('fixture.mode', { mode: 'late-start' });
			const starting = rejection(binding.start());
			statusSocket.close();
			await statusSocket.open();
			await starting;
			expect(
				(await rejection(binding.stop()))?.code === 'remote_unavailable',
				'late stop stays on original socket',
			);
			const empty = { available: true, containers: [] };
			let mutation = deferred(),
				readFailure = false,
				commandCalls = 0;
			const channel = {
				async getStatus() {
					if (readFailure) {
						throw new DockerFailure('remote_unavailable', 'confirmed');
					}
					return empty;
				},

				command() {
					commandCalls++;
					return mutation.promise;
				},

				async getStats() {
					return null;
				},
			};
			const state = createDockerSession(channel);
			controllers.push(state);
			state.setIntervalSeconds(86400);
			state.activate();
			state.workspaceConnected();
			await state.refresh();
			const writing = state.command('abc', 'restart');
			expect(state.commandPending.value, 'pending write exposed');
			expect(
				(await rejection(state.command('abc', 'restart')))?.code === 'conflict' && commandCalls === 1,
				'concurrent write never dispatches',
			);
			mutation.reject(new DockerFailure('operation_unknown', 'unknown'));
			await rejection(writing);
			expect(
				state.commandBlocked.value && state.error.value === 'operation_unknown',
				'unknown sets sticky recovery guard',
			);
			await state.refresh();
			expect(
				state.commandBlocked.value && state.error.value === 'operation_unknown',
				'poll success cannot clear unknown',
			);
			await rejection(state.command('abc', 'stop'));
			expect(state.commandBlocked.value && commandCalls === 1, 'different rejected intent cannot clear unknown');
			state.deactivate();
			state.activate();
			await state.refresh();
			expect(state.commandBlocked.value, 'KeepAlive retains unknown');
			readFailure = true;
			await state.reconcile();
			expect(state.commandBlocked.value, 'failed read cannot release unknown');
			readFailure = false;
			await state.reconcile();
			expect(
				!state.commandBlocked.value && state.error.value === null,
				'explicit successful read releases local recovery guard',
			);
			mutation = deferred();
			const confirmed = state.command('abc', 'stop');
			readFailure = true;
			mutation.resolve();
			await confirmed;
			expect(
				!state.commandBlocked.value && state.error.value === 'remote_unavailable',
				'post-command read failure does not turn confirmed write into unknown',
			);
			let oldRead = deferred();
			channel.getStatus = () => oldRead.promise;
			readFailure = false;
			const stale = state.refresh(true);
			await Promise.resolve();
			state.workspaceDisconnected();
			oldRead.resolve({ available: true, containers: [{ id: 'old' }] });
			await stale;
			expect(
				state.containers.value.length === 0 && !state.loading.value,
				'old read and finally cannot publish across disconnect',
			);
		} finally {
			for (const controller of controllers) {
				controller.dispose();
			}
			for (const socket of sockets) {
				socket.close();
			}
		}
		assert.equal(
			calls.filter((call) => call.type === 'docker.command').length,
			2,
			'only two explicit dispatched mutation fixtures',
		);
		assert.equal(
			calls.filter((call) => call.type === 'status.stop' && call.mode === 'normal').length,
			0,
			'late stop never sent on replacement connection',
		);
	} finally {
		for (const timer of timers) clearTimeout(timer);
		await peer.close();
	}
});
