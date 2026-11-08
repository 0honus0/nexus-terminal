import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAgentExecution } from '../support/agent-execution-fixture.mjs';
import { expectStatus, openSshd, until } from '../../../../support/protocols/openssh-fixture.mjs';
import { readAgentStreamFrame } from '../../../../../packages/shared/dist/agent/runs/events.js';

await test(
	'Agent modular: one WS isolates subscription credit and reconnect reads without replaying Runs',
	{ timeout: 90000 },
	async (t) => {
		const directory = await mkdtemp(
			join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'nexus-modular-stream-'),
		);
		const sshd = await openSshd(directory);
		let f;
		const sockets = new Set();
		t.after(async () => {
			const failures = [];
			for (const close of [
				async () => {
					await Promise.all(
						[...sockets].map(async (socket) => {
							if (socket.readyState === 3) return;
							const closed = once(socket, 'close');
							socket.terminate();
							await closed;
						}),
					);
				},
				() => f?.close(),
				() => sshd.close(),
				() =>
					process.env.NEXUS_AGENT_ACCEPTANCE_ROOT
						? undefined
						: rm(directory, { recursive: true, force: true }),
			]) {
				try {
					await close();
				} catch (error) {
					failures.push(error);
				}
			}
			if (failures.length) throw new AggregateError(failures, 'Multiplex fixture cleanup failed');
		});
		f = await openAgentExecution(directory, sshd);
		const first = await f.start('first multiplex run', () => ({ chunks: ['first prefix'], hold: true }));
		const second = await f.start('second multiplex run', () => ({ chunks: ['second prefix'], hold: true }));
		await until(
			() => f.heldModelCount,
			(count) => count === 2,
			'both real Provider responses remain open',
		);
		const app = expectStatus(await f.api('GET', '/api/v1/agent/apps/' + f.appId), 200);

		const source = (run) => ({
			kind: 'run',
			appId: f.appId,
			access: { kind: 'session', appVersion: app.version },
			runId: run.id,
			cursor: {
				threadId: run.threadId,
				entries: { runSequence: 0, messageOrdinal: 0, chunkIndex: 0, textOffset: 0 },
				events: 0,
				approvals: null,
			},
		});

		async function connect() {
			const socket = f.openRunStream();
			sockets.add(socket);
			const messages = [];
			socket.on('message', (bytes) => messages.push(readAgentStreamFrame(JSON.parse(bytes.toString()))));
			await once(socket, 'open');
			return {
				socket,
				messages,

				send: (command) => socket.send(JSON.stringify(command)),
			};
		}

		const channel = await connect();
		const firstId = randomUUID(),
			secondId = randomUUID();
		channel.send({ type: 'subscribe', subscriptionId: firstId, generation: 1, source: source(first) });
		channel.send({ type: 'subscribe', subscriptionId: secondId, generation: 1, source: source(second) });
		const firstFrame = await until(
			() => channel.messages.find((frame) => frame.type === 'data' && frame.subscriptionId === firstId),
			Boolean,
			'first subscription snapshot',
		);
		const secondFrame = await until(
			() => channel.messages.find((frame) => frame.type === 'data' && frame.subscriptionId === secondId),
			Boolean,
			'second subscription snapshot',
		);
		assert.equal(firstFrame.value.state.run.id, first.id);
		assert.equal(secondFrame.value.state.run.id, second.id);
		f.finishModels();
		await f.wait(first, 'completed');
		await f.wait(second, 'completed');
		let terminal;
		let cursor = source(second).cursor;
		let body = '';
		for (let index = 0; !terminal; index++) {
			const frame = await until(
				() =>
					channel.messages.filter((item) => item.type === 'data' && item.subscriptionId === secondId)[index],
				Boolean,
				'second subscription continues while first is unacknowledged',
			);
			body += frame.value.body.items.map((item) => item.text).join('');
			cursor = {
				threadId: second.threadId,
				entries: frame.value.body.nextCursor,
				events: frame.value.state?.events.nextCursor ?? cursor.events,
				approvals: frame.value.state?.approvals.nextCursor ?? cursor.approvals,
			};
			terminal = frame.value.state?.run.status === 'completed' ? frame : null;
			channel.send({ type: 'ack', subscriptionId: secondId, generation: 1, revision: frame.revision });
		}
		assert.match(body, /second prefix/);
		assert.match(body, /Fixture released/);
		assert.equal(
			channel.messages.filter((frame) => frame.type === 'data' && frame.subscriptionId === firstId).length,
			1,
		);
		const closed = once(channel.socket, 'close');
		channel.socket.terminate();
		await closed;
		const resumed = await connect();
		resumed.send({
			type: 'subscribe',
			subscriptionId: secondId,
			generation: 2,
			source: { ...source(second), cursor },
		});
		const restored = await until(
			() => resumed.messages.find((frame) => frame.type === 'data'),
			Boolean,
			'reconnected authoritative snapshot',
		);
		assert.equal(restored.generation, 2);
		assert.equal(restored.value.state.run.status, 'completed');
		assert.deepEqual(restored.value.body.items, [], 'applied text is not duplicated on reconnect');
		assert.equal(f.calls.length, 2, 'read-only subscription recovery never replays model execution');
		resumed.send({ type: 'unsubscribe', subscriptionId: secondId, generation: 2 });
		assert.equal(
			(await f.wait(second, 'completed')).status,
			'completed',
			'view unsubscribe does not cancel an accepted Run',
		);
	},
);
