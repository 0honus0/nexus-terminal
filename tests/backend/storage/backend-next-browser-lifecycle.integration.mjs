import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import puppeteer from '../../../packages/backend/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { NativeBrowserClient } from '../../../packages/backend/dist/platform/browser/adapters/native-browser-client.js';
import { BrowserFailure } from '../../../packages/backend/dist/platform/browser/browser-client.js';
import { until } from '../remote/openssh-fixture.mjs';

const requireE2e = createRequire(new URL('../../e2e/package.json', import.meta.url));
const { chromium } = requireE2e('@playwright/test');

function gate() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function contains(error, expected) {
	return (
		error === expected ||
		(error instanceof AggregateError && error.errors.some((value) => contains(value, expected))) ||
		(error instanceof Error && error.cause !== undefined && contains(error.cause, expected))
	);
}

await test('Browser actual CDP construction cancellation and cleanup fault ownership', async (t) => {
	const browser = await puppeteer.launch({
		executablePath: chromium.executablePath(),
		headless: true,
		args: ['--no-sandbox', '--disable-dev-shm-usage'],
	});
	const observer = await browser.target().createCDPSession();
	const independent = await browser.createBrowserContext();
	t.after(() => browser.close());
	const options = {
		endpoint: browser.wsEndpoint(),
		verifyTls: true,

		allowUrl: () => true,
	};

	async function contexts() {
		return (await observer.send('Target.getBrowserContexts')).browserContextIds;
	}

	async function clean() {
		await until(
			contexts,
			(ids) => ids.length === 1 && ids[0] === independent.id,
			'Only the independent context survives',
		);
		assert.equal(browser.connected, true);
	}

	for (const phase of ['context', 'page', 'configuration']) {
		await t.test(
			'cancel during ' + phase + ' construction closes the actual late context exactly once',
			async (t) => {
				const entered = gate();
				const release = gate();
				const controller = new AbortController();
				const originalConnect = puppeteer.connect.bind(puppeteer);
				let closeCount = 0;
				let contextId;
				t.after(() => release.resolve());
				t.mock.method(puppeteer, 'connect', async (input) => {
					const connected = await originalConnect(input);
					const create = connected.createBrowserContext.bind(connected);
					t.mock.method(connected, 'createBrowserContext', async (...args) => {
						const context = await create(...args);
						contextId = context.id;
						const close = context.close.bind(context);
						t.mock.method(context, 'close', async () => {
							closeCount += 1;
							await close();
						});
						const newPage = context.newPage.bind(context);
						t.mock.method(context, 'newPage', async () => {
							const page = await newPage();
							if (phase === 'page') {
								entered.resolve();
								await release.promise;
							}
							if (phase === 'configuration') {
								const configure = page.setBypassServiceWorker.bind(page);
								t.mock.method(page, 'setBypassServiceWorker', async (value) => {
									entered.resolve();
									await release.promise;
									await configure(value);
								});
							}
							return page;
						});
						if (phase === 'context') {
							entered.resolve();
							await release.promise;
						}
						return context;
					});
					return connected;
				});
				const pending = new NativeBrowserClient().connect(options, controller.signal).then(
					(value) => ({ value }),
					(error) => ({ error }),
				);
				await entered.promise;
				assert.ok((await contexts()).includes(contextId));
				controller.abort();
				release.resolve();
				const result = await pending;
				assert.ok(result.error instanceof BrowserFailure);
				assert.equal(result.error.kind, 'unavailable');
				assert.equal(closeCount, 1);
				await clean();
			},
		);
	}

	await t.test(
		'construction and synchronous context-close failure retain both causes without a second close',
		async (t) => {
			const originalConnect = puppeteer.connect.bind(puppeteer);
			const operationError = new Error('controlled page configuration failure');
			const cleanupError = new Error('controlled synchronous context close failure');
			let contextId;
			let closes = 0;
			let disconnects = 0;
			t.mock.method(puppeteer, 'connect', async (input) => {
				const connected = await originalConnect(input);
				const create = connected.createBrowserContext.bind(connected);
				const disconnect = connected.disconnect.bind(connected);
				t.mock.method(connected, 'disconnect', async () => {
					disconnects += 1;
					await disconnect();
				});
				t.mock.method(connected, 'createBrowserContext', async () => {
					const context = await create();
					contextId = context.id;
					t.mock.method(context, 'close', () => {
						closes += 1;
						throw cleanupError;
					});
					const newPage = context.newPage.bind(context);
					t.mock.method(context, 'newPage', async () => {
						const page = await newPage();
						t.mock.method(page, 'setBypassServiceWorker', () => {
							throw operationError;
						});
						return page;
					});
					return context;
				});
				return connected;
			});
			try {
				await assert.rejects(
					new NativeBrowserClient().connect(options, new AbortController().signal),
					(error) =>
						error instanceof BrowserFailure &&
						error.kind === 'cleanup_failed' &&
						contains(error, operationError) &&
						contains(error, cleanupError),
				);
				assert.equal(closes, 1);
				assert.equal(disconnects, 1);
				assert.ok((await contexts()).includes(contextId), 'a failed context close is not a confirmed release');
			} finally {
				if (contextId) {
					await observer.send('Target.disposeBrowserContext', { browserContextId: contextId });
				}
			}
			await clean();
		},
	);

	await t.test(
		'keyboard release continues after one synchronous vendor failure and screenshot preflight avoids vendor dispatch',
		async (t) => {
			const originalConnect = puppeteer.connect.bind(puppeteer);
			const keyError = new Error('controlled key-up failure');
			const releases = [];
			let screenshots = 0;
			t.mock.method(puppeteer, 'connect', async (input) => {
				const connected = await originalConnect(input);
				const create = connected.createBrowserContext.bind(connected);
				t.mock.method(connected, 'createBrowserContext', async () => {
					const context = await create();
					const newPage = context.newPage.bind(context);
					t.mock.method(context, 'newPage', async () => {
						const page = await newPage();
						const up = page.keyboard.up.bind(page.keyboard);
						t.mock.method(page.keyboard, 'up', (key) => {
							releases.push(key);
							if (key === 'A') {
								throw keyError;
							}
							return up(key);
						});
						const screenshot = page.screenshot.bind(page);
						t.mock.method(page, 'screenshot', async (...args) => {
							screenshots += 1;
							return screenshot(...args);
						});
						return page;
					});
					return context;
				});
				return connected;
			});
			const session = await new NativeBrowserClient().connect(options, new AbortController().signal);
			try {
				await assert.rejects(
					session.perform(
						{ kind: 'press', key: 'A', modifiers: ['Shift', 'Control'], focus: null, settleMs: 0 },
						new AbortController().signal,
					),
					(error) =>
						error instanceof BrowserFailure &&
						error.kind === 'execution_unknown' &&
						contains(error, keyError),
				);
				// Puppeteer press first attempts its own key-up; the owner then releases every key independently.
				assert.deepEqual(releases, ['A', 'A', 'Control', 'Shift']);
				await assert.rejects(
					session.screenshot(0, new AbortController().signal),
					(error) => error instanceof BrowserFailure && error.kind === 'limit_exceeded',
				);
				assert.equal(screenshots, 0);
			} finally {
				await session.close();
			}
			await clean();
		},
	);

	await t.test('aborting an actual WebSocket handshake releases the pending socket', async (t) => {
		const sockets = new Set();
		let requested = false;
		const server = createServer();
		server.on('connection', (socket) => {
			sockets.add(socket);
			socket.once('close', () => sockets.delete(socket));
		});
		server.on('upgrade', (_request, socket) => {
			requested = true;
			// An upgraded server socket owns its half-close; observe the peer EOF before retiring it.
			socket.once('end', () => socket.end());
			socket.resume();
		});
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		t.after(async () => {
			for (const socket of sockets) {
				socket.destroy();
			}
			await new Promise((resolve) => server.close(resolve));
		});
		const controller = new AbortController();
		const pending = new NativeBrowserClient()
			.connect({ ...options, endpoint: 'ws://127.0.0.1:' + server.address().port }, controller.signal)
			.then(
				(value) => ({ value }),
				(error) => ({ error }),
			);
		await until(() => requested, Boolean, 'Actual Browser WebSocket handshake');
		controller.abort();
		const result = await pending;
		assert.ok(result.error instanceof BrowserFailure);
		assert.equal(result.error.kind, 'unavailable');
		await until(
			() => sockets.size,
			(count) => count === 0,
			'Aborted Browser transport closed',
		);
		await clean();
	});
});

await test('Browser session lanes isolate pending snapshots and plugin retirement waits for admitted sessions', async () => {
	const { BrowserService } =
		await import('../../../packages/backend/dist/modules/agent/integrations/service/browser-service.js');
	const firstEntered = gate(),
		releaseFirst = gate(),
		secondDone = gate();
	const sessions = [];
	let retired = false;
	const service = new BrowserService(
		{
			configuration: async () => ({
				version: 1,
				targets: [
					{
						id: 'target',
						endpoints: [{ url: 'http://fixture', verifyTls: true, priority: 0 }],
						allowedUrlPatterns: [],
					},
				],
			}),

			connect: async () => {
				const index = sessions.length;
				const session = {
					closed: false,

					snapshot: async () => {
						if (index === 0) {
							firstEntered.resolve();
							await releaseFirst.promise;
						} else secondDone.resolve();
						return {
							snapshotId: 'snapshot',
							url: 'about:blank',
							title: 'lane',
							nodes: [],
							truncated: false,
						};
					},

					close: async () => {
						session.closed = true;
					},
				};
				sessions.push(session);
				return session;
			},
		},
		null,
	);
	const owner = { userId: 1, appId: 'app', runId: 'run', operationId: 'first', operationHash: 'a'.repeat(64) };
	const source = {
		instanceId: 'browser-instance',
		generation: 'browser-generation',

		read: async () => ({ revision: 1, documentJson: '{}' }),
	};
	const signal = new AbortController().signal;

	const validate = async () => {};

	const outputArtifactIds = [];

	const recordOutputArtifacts = (ids) => outputArtifactIds.push(...ids);

	try {
		const first = await service.perform(
			owner,
			source,
			{ action: 'open', targetId: 'target', expectedVersion: 1 },
			signal,
			validate,
			recordOutputArtifacts,
		);
		const second = await service.perform(
			{ ...owner, operationId: 'second' },
			source,
			{ action: 'open', targetId: 'target', expectedVersion: 1 },
			signal,
			validate,
			recordOutputArtifacts,
		);

		assert.equal(first.action, 'open');
		assert.equal(second.action, 'open');

		const snapshot = (sessionId) => ({
			action: 'snapshot',
			sessionId,
			maxNodes: 100,
		});

		const held = service.perform(
			owner,
			source,
			snapshot(first.value.sessionId),
			signal,
			validate,
			recordOutputArtifacts,
		);
		await firstEntered.promise;
		const independent = service.perform(
			owner,
			source,
			snapshot(second.value.sessionId),
			signal,
			validate,
			recordOutputArtifacts,
		);
		await independent;
		await secondDone.promise;
		const update = service
			.retireInstance({ userId: 1, appId: 'app', instanceId: source.instanceId, generation: source.generation })
			.then(() => {
				retired = true;
			});
		const stale = assert.rejects(
			service.perform(owner, source, snapshot(second.value.sessionId), signal, validate, recordOutputArtifacts),
			(error) => error.code === 'not_found',
		);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(retired, false, 'configuration cannot retire a context with an admitted snapshot');
		const independentCatalog = await service.catalog({ ...source, instanceId: 'other-instance' }, signal, validate);
		assert.equal(
			independentCatalog.targets[0].targetId,
			'target',
			'Retiring one instance does not stall another instance behind its pending snapshot',
		);
		releaseFirst.resolve();
		await held;
		await update;
		await stale;
		assert.equal(retired, true);
		assert.ok(sessions.every((session) => session.closed));
		assert.deepEqual(outputArtifactIds, [], 'open and snapshot do not publish artifacts');
	} finally {
		releaseFirst.resolve();
		await service.close();
	}
});

await test('Browser plugin configuration isolates instances, fences stale revisions and retires only the exact generation', async () => {
	const { BrowserService } =
		await import('../../../packages/backend/dist/modules/agent/integrations/service/browser-service.js');
	const { BrowserModel } =
		await import('../../../packages/backend/dist/modules/agent/integrations/model/browser-model.js');
	const { AgentFailure } = await import('../../../packages/backend/dist/modules/agent/agent-failure.js');
	const connections = [];
	const model = new BrowserModel({
		connect: async (input) => {
			const connection = {
				endpoint: input.endpoint,
				closed: false,

				close: async () => {
					connection.closed = true;
				},
			};
			connections.push(connection);
			return connection;
		},
	});
	const service = new BrowserService(model, null);
	let revision = 1;

	const source = (instanceId, generation = 'generation') => ({
		instanceId,
		generation,

		read: async () => ({
			revision,
			documentJson: JSON.stringify({
				targets: [
					{
						id: instanceId,
						endpoints: [
							{
								url: 'wss://' + instanceId + '.example/cdp',
								priority: 800,
								allowPlaintext: false,
								verifyTls: true,
							},
						],
						allowedUrlPatterns: ['https://' + instanceId + '.example/*'],
					},
				],
			}),
		}),
	});

	const firstSource = source('first'),
		secondSource = source('second');
	const owner = { userId: 1, appId: 'app', runId: 'run', operationId: 'operation', operationHash: 'a'.repeat(64) };
	const signal = new AbortController().signal;

	const validate = async () => {};

	const open = (config, targetId) =>
		service.perform(
			owner,
			config,
			{ action: 'open', targetId, expectedVersion: revision },
			signal,
			validate,
			() => {},
		);

	try {
		assert.deepEqual(
			(await service.catalog(firstSource, signal, validate)).targets.map((target) => target.targetId),
			['first'],
		);
		assert.deepEqual(
			(await service.catalog(secondSource, signal, validate)).targets.map((target) => target.targetId),
			['second'],
		);
		await assert.rejects(open(firstSource, 'second'), (error) => error.code === 'not_found');
		const first = await open(firstSource, 'first'),
			second = await open(secondSource, 'second');
		await assert.rejects(
			service.perform(
				owner,
				secondSource,
				{ action: 'close', sessionId: first.value.sessionId },
				signal,
				validate,
				() => {},
			),
			(error) => error.code === 'not_found',
		);
		await service.retireInstance({ userId: 1, appId: 'app', instanceId: 'first', generation: 'other' });
		assert.equal(connections[0].closed, false);
		await service.retireInstance({
			userId: 1,
			appId: 'app',
			instanceId: 'first',
			generation: firstSource.generation,
		});
		assert.equal(connections[0].closed, true);
		assert.equal(connections[1].closed, false);
		revision++;
		await assert.rejects(
			service.perform(
				owner,
				secondSource,
				{ action: 'console', sessionId: second.value.sessionId, after: 0, limit: 1 },
				signal,
				validate,
				() => {},
			),
			(error) => error.code === 'version_conflict',
		);
		const revoked = {
			instanceId: 'revoked',
			generation: 'old',

			read: async () => {
				throw new AgentFailure('version_conflict');
			},
		};
		await assert.rejects(service.catalog(revoked, signal, validate), (error) => error.code === 'version_conflict');
		service.quiesce();
		await service.retireInstance({
			userId: 1,
			appId: 'app',
			instanceId: 'second',
			generation: secondSource.generation,
		});
		assert.equal(connections[1].closed, true, 'Global shutdown and instance retirement share real cleanup');
	} finally {
		await service.close();
	}
});
