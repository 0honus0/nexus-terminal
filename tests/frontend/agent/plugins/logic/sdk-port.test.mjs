import assert from 'node:assert/strict';
import { test, vi, afterEach } from 'vitest';

let cleanup = [];
afterEach(async () => {
	const results = await Promise.allSettled(cleanup.map((close) => Promise.resolve().then(close)));
	cleanup = [];
	vi.unstubAllGlobals();
	const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
	if (failures.length) throw new AggregateError(failures, 'SDK test cleanup failed');
});

// Test source contracts here; signed delivery and real MessagePort isolation
// are independently covered by the native plugin browser integration.
async function connected(expectedCloseFailure) {
	const client = await import('../../../../../packages/frontend/src/features/agent/plugins/sdk/index.ts');
	const messages = [];
	const appId = crypto.randomUUID();
	const nonce = crypto.randomUUID();
	const windowListeners = new Map();
	const portListeners = new Map();
	const port = {
		postMessage(value) {
			if (value.type !== 'nexus.plugin.ack') messages.push(value);
		},

		addEventListener(type, listener) {
			portListeners.set(type, listener);
		},

		removeEventListener(type) {
			portListeners.delete(type);
		},

		start() {},

		close() {},
	};
	vi.stubGlobal('window', {
		parent: {
			postMessage(value) {
				assert.deepEqual(value, { type: 'nexus.plugin.ready', protocol: 4 });
				queueMicrotask(() =>
					windowListeners.get('message')({
						data: { type: 'nexus.plugin.init', protocol: 4, nonce, appId, expiresAt: Date.now() + 60000 },
						source: window.parent,
						ports: [port],
					}),
				);
			},
		},

		addEventListener(type, listener) {
			windowListeners.set(type, listener);
		},

		removeEventListener(type) {
			windowListeners.delete(type);
		},
	});
	const sdk = await client.connectNexusPlugin();
	let closed = false;
	sdk.ui.onClose(() => {
		closed = true;
	});

	const receive = (data) => portListeners.get('message')({ data, ports: [] });

	receive({
		type: 'nexus.ui.environment',
		environment: {
			appId,
			appVersion: 1,
			checkpoint: null,
			active: true,
			minimized: false,
			compact: false,
			executionEnabled: true,
			resumeRevision: 0,
			locale: 'en-US',
			dark: false,
			themeVariables: [],
			imagePreviewMaxMiB: 10,
			targets: [],
			preferredTargetIds: [],
		},
	});
	await sdk.ui.ready;
	cleanup.push(() => (expectedCloseFailure ? assert.rejects(sdk.close(), expectedCloseFailure) : sdk.close()));
	return {
		sdk,
		appId,
		messages,
		receive,

		closed: () => closed,
	};
}

test('Malformed Host results reject the owning pending request and close the UI scope', async () => {
	const assertCloseFailure = (error) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.errors.length, 1);
		assert.ok(error.errors[0] instanceof Error);
		assert.equal(error.errors[0].name, 'InvalidAgentPayload');
		return true;
	};

	const owner = await connected(assertCloseFailure);
	const result = owner.sdk.ui.request({ kind: 'window.open' }).catch((error) => error);
	owner.receive({
		type: 'nexus.ui.response',
		id: owner.messages[0].id,
		result: { kind: 'window.open', accepted: false },
	});
	const failure = await result;
	assert.equal(failure.code, 'cancelled');
	assert.equal(failure.outcome, 'unknown');
	assert.equal(owner.closed(), true);
	const close = owner.sdk.close();
	assert.strictEqual(owner.sdk.close(), close);
	await assert.rejects(close, assertCloseFailure);
});

test('Host business errors retain their named code and dispatch outcome', async () => {
	const owner = await connected();
	const result = owner.sdk.ui.request({ kind: 'window.open' }).catch((error) => error);
	owner.receive({
		type: 'nexus.ui.failure',
		id: owner.messages[0].id,
		error: { code: 'version_conflict', outcome: 'confirmed' },
	});
	const failure = await result;
	assert.equal(failure.code, 'version_conflict');
	assert.equal(failure.outcome, 'confirmed');
	assert.equal(owner.closed(), false);
});

test('UI SDK correlates more than 32 pending requests and keeps more than eight subscriptions independent', async () => {
	const owner = await connected();
	const requests = Array.from({ length: 48 }, () => owner.sdk.ui.request({ kind: 'window.open' }));
	const sent = owner.messages.slice();
	assert.equal(sent.length, 48);
	assert.equal(new Set(sent.map((message) => message.id)).size, 48);
	for (const message of sent.slice().reverse()) {
		owner.receive({ type: 'nexus.ui.response', id: message.id, result: { kind: 'window.open', accepted: true } });
	}
	assert.equal((await Promise.all(requests)).length, 48);
	const applied = new Set();
	const subscriptions = Array.from({ length: 16 }, (_, index) =>
		owner.sdk.ui.streams.subscribe({
			source: () => ({ kind: 'memory', threadId: null }),

			apply() {
				applied.add(index);
				return true;
			},

			rejected() {
				assert.fail('independent subscription failed');
			},
		}),
	);
	const sources = owner.messages.filter((message) => message.type === 'nexus.ui.stream.subscribe');
	assert.equal(sources.length, 16);
	for (const message of sources) {
		owner.receive({
			type: 'nexus.ui.stream.page',
			id: message.id,
			generation: 1,
			revision: 1,
			delivery: 1,
			value: { type: 'memory-invalidated', epoch: crypto.randomUUID(), revision: 1 },
		});
	}
	assert.equal(applied.size, 16);
	for (const subscription of subscriptions) subscription.close();
	assert.equal(owner.messages.filter((message) => message.type === 'nexus.ui.stream.unsubscribe').length, 16);
	assert.equal(owner.closed(), false);
});

test('Cancellation distinguishes requests stopped before and after dispatch', async () => {
	const owner = await connected();
	const before = new AbortController();
	before.abort();
	const refused = await owner.sdk.ui.request({ kind: 'window.open' }, before.signal).catch((error) => error);
	assert.equal(refused.outcome, 'not_dispatched');
	assert.equal(owner.messages.length, 0);
	const after = new AbortController();
	const pending = owner.sdk.ui.request({ kind: 'window.open' }, after.signal).catch((error) => error);
	after.abort();
	const cancelled = await pending;
	assert.equal(cancelled.code, 'cancelled');
	assert.equal(cancelled.outcome, 'unknown');
	assert.deepEqual(owner.messages[1], { type: 'nexus.ui.cancel', id: owner.messages[0].id });
});

test('Page delivery uses the public source and waits for actual application before ACK', async () => {
	const owner = await connected();
	let applied = false;
	const subscription = owner.sdk.ui.streams.subscribe({
		source: () => ({
			kind: 'memory',
			threadId: null,
		}),

		apply: () => applied,

		rejected() {
			assert.fail('Unexpected stream rejection');
		},
	});
	const sent = owner.messages[0];
	assert.deepEqual(sent.source, { kind: 'memory', threadId: null });
	owner.receive({
		type: 'nexus.ui.stream.page',
		id: sent.id,
		generation: 2,
		revision: 1,
		delivery: 1,
		value: { type: 'memory-invalidated', epoch: crypto.randomUUID(), revision: 1 },
	});
	assert.equal(owner.messages.length, 1);
	applied = true;
	subscription.resume();
	assert.deepEqual(owner.messages[1], {
		type: 'nexus.ui.stream.ack',
		id: sent.id,
		generation: 2,
		revision: 1,
		delivery: 1,
	});
	subscription.close();
	assert.deepEqual(owner.messages[2], { type: 'nexus.ui.stream.unsubscribe', id: sent.id });
});

test('A completed native Run can unsubscribe during page application without closing other UI work', async () => {
	const owner = await connected();
	const appId = owner.appId;
	const threadId = crypto.randomUUID();
	const runId = crypto.randomUUID();
	const entries = { runSequence: 0, messageOrdinal: 0, chunkIndex: 0, textOffset: 0 };
	let applied = 0;
	const subscription = owner.sdk.ui.streams.subscribe({
		source: () => ({ kind: 'run', runId, cursor: { threadId, entries, events: 0, approvals: null } }),

		apply(update) {
			assert.equal(update.state.run.status, 'completed');
			assert.deepEqual(update.state.resources, []);
			applied++;
			// The actual terminal consumer retires observation synchronously during apply.
			subscription.close();
			return true;
		},

		rejected() {
			assert.fail('Valid completed Run page must not fail decoding');
		},
	});
	const sent = owner.messages[0];
	let invalidations = 0;
	const memory = owner.sdk.ui.streams.subscribe({
		source: () => ({ kind: 'memory', threadId }),

		apply() {
			invalidations++;
			return true;
		},

		rejected() {
			assert.fail('Another subscription must survive terminal Run disposal');
		},
	});
	const memorySent = owner.messages[1];
	owner.receive({
		type: 'nexus.ui.stream.page',
		id: sent.id,
		generation: 1,
		revision: 1,
		delivery: 1,
		value: {
			type: 'update',
			appId,
			runId,
			revision: 1,
			body: { appId, threadId, items: [], nextCursor: entries },
			state: {
				thread: {
					id: threadId,
					appId,
					title: 'Completed conversation',
					version: 1,
					createdAt: 1,
					updatedAt: 1,
				},
				run: {
					id: runId,
					appId,
					threadId,
					status: 'completed',
					failure: null,
					approvalMode: 'ask',
					version: 2,
					createdAt: 1,
					updatedAt: 2,
				},
				usage: {
					runId,
					runVersion: 2,
					inputTokens: null,
					outputTokens: null,
					reportedModelRequests: 0,
					modelRequests: 1,
					toolExecutions: 0,
				},
				events: { items: [], nextCursor: 0 },
				approvals: { items: [], after: null, nextCursor: null, hasMore: false },
				children: { items: [] },
				resources: [],
			},
			more: false,
		},
	});
	assert.equal(applied, 1);
	assert.deepEqual(
		owner.messages.filter((message) => message.id === sent.id).map((message) => message.type),
		['nexus.ui.stream.subscribe', 'nexus.ui.stream.unsubscribe'],
	);
	assert.equal(owner.closed(), false);
	owner.receive({
		type: 'nexus.ui.stream.page',
		id: memorySent.id,
		generation: 1,
		revision: 1,
		delivery: 1,
		value: { type: 'memory-invalidated', epoch: crypto.randomUUID(), revision: 1 },
	});
	assert.equal(invalidations, 1);
	assert.equal(owner.messages.at(-1).type, 'nexus.ui.stream.ack');
	assert.equal(owner.messages.at(-1).id, memorySent.id);
	const request = owner.sdk.ui.request({ kind: 'window.open' });
	const requestId = owner.messages.at(-1).id;
	owner.receive({ type: 'nexus.ui.response', id: requestId, result: { kind: 'window.open', accepted: true } });
	assert.deepEqual(await request, { kind: 'window.open', accepted: true });
	memory.close();
});

test('Run event pages queue behind an asynchronous consumer and acknowledge in delivery order', async () => {
	const owner = await connected();
	const runId = crypto.randomUUID();
	let release;
	let entered;
	const started = new Promise((resolve) => {
		entered = resolve;
	});
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const delivered = [];
	const failures = [];
	const sub = owner.sdk.agent.runs.subscribe(
		runId,
		0,
		async (page) => {
			delivered.push(page.nextCursor);
			if (page.nextCursor === 1) {
				entered();
				await gate;
			}
		},
		(error) => {
			failures.push(error);
		},
	);
	try {
		const command = owner.messages.find((message) => message.command === 'subscribe');

		const send = (revision, sequence, empty = false) =>
			owner.receive({
				type: 'nexus.plugin.stream-event',
				protocol: 4,
				nonce: command.nonce,
				subscriptionId: sub.id,
				generation: 1,
				ok: true,
				revision,
				value: {
					items: empty ? [] : [{ runId, sequence, type: 'run.started', runVersion: sequence, createdAt: 1 }],
					nextCursor: sequence,
				},
			});

		send(1, 1);
		await started;
		send(2, 2);
		send(3, 2, true);
		assert.deepEqual(delivered, [1]);
		assert.equal(owner.closed(), false);
		assert.deepEqual(
			owner.messages.filter((message) => message.command === 'ack'),
			[],
		);
		release();
		await vi.waitFor(() =>
			assert.deepEqual(
				owner.messages.filter((message) => message.command === 'ack').map((message) => message.revision),
				[1, 2, 3],
			),
		);
		assert.deepEqual(delivered, [1, 2]);
		assert.deepEqual(failures, []);
	} finally {
		release();
		await owner.sdk.agent.runs.unsubscribe(sub.id);
	}
});

test('Run unsubscribe waits its active consumer and discards queued pages without acknowledgements', async () => {
	const owner = await connected();
	const runId = crypto.randomUUID();
	let release;
	let entered;
	const started = new Promise((resolve) => {
		entered = resolve;
	});
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const delivered = [];
	const sub = owner.sdk.agent.runs.subscribe(
		runId,
		0,
		async (page) => {
			delivered.push(page.nextCursor);
			entered();
			await gate;
		},
		(error) => {
			throw error;
		},
	);
	let stopped = false;
	let stopping;
	try {
		const command = owner.messages.find((message) => message.command === 'subscribe');
		for (const sequence of [1, 2]) {
			owner.receive({
				type: 'nexus.plugin.stream-event',
				protocol: 4,
				nonce: command.nonce,
				subscriptionId: sub.id,
				generation: 1,
				ok: true,
				revision: sequence,
				value: {
					items: [{ runId, sequence, type: 'run.started', runVersion: sequence, createdAt: 1 }],
					nextCursor: sequence,
				},
			});
		}
		await started;
		stopping = owner.sdk.agent.runs.unsubscribe(sub.id).then(() => {
			stopped = true;
		});
		await Promise.resolve();
		assert.equal(stopped, false);
		assert.equal(owner.closed(), false);
		release();
		await stopping;
		await sub.closed;
		assert.equal(stopped, true);
		assert.deepEqual(delivered, [1]);
		assert.deepEqual(
			owner.messages.filter((message) => message.command === 'ack'),
			[],
		);
	} finally {
		release();
		await stopping;
		await owner.sdk.agent.runs.unsubscribe(sub.id);
	}
});

test('Queued Run pages still reject a repeated event cursor and drain the active consumer on close', async () => {
	const owner = await connected();
	const runId = crypto.randomUUID();
	let release;
	let entered;
	const started = new Promise((resolve) => {
		entered = resolve;
	});
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	let delivered = 0;
	const sub = owner.sdk.agent.runs.subscribe(
		runId,
		0,
		async () => {
			delivered++;
			entered();
			await gate;
		},
		(error) => {
			throw error;
		},
	);
	try {
		const command = owner.messages.find((message) => message.command === 'subscribe');
		const event = {
			type: 'nexus.plugin.stream-event',
			protocol: 4,
			nonce: command.nonce,
			subscriptionId: sub.id,
			generation: 1,
			ok: true,
			revision: 1,
			value: { items: [{ runId, sequence: 1, type: 'run.started', runVersion: 1, createdAt: 1 }], nextCursor: 1 },
		};
		owner.receive(event);
		await started;
		owner.receive({ ...event, revision: 2 });
		assert.equal(owner.closed(), true);
		let stopped = false;
		const closing = owner.sdk.close().then(() => {
			stopped = true;
		});
		await Promise.resolve();
		assert.equal(stopped, false);
		release();
		await closing;
		await sub.closed;
		assert.equal(delivered, 1);
		assert.deepEqual(
			owner.messages.filter((message) => message.command === 'ack'),
			[],
		);
	} finally {
		release();
		await owner.sdk.close();
	}
});
