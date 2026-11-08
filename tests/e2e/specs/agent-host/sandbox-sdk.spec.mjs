import assert from 'node:assert/strict';
import { test } from '../../support/agent-host/sandbox-fixtures.mjs';
import { randomUUID } from 'node:crypto';
import { openPlugins } from '../../../backend/agent/plugins/support/plugin-management-fixture.mjs';
import { openPluginBrowser } from '../../support/agent-host/sandbox-browser.mjs';
import { expectStatus, until } from '../../../support/protocols/openssh-fixture.mjs';

test('Signed sandbox, complete SDK imports and MessagePort RPC', async ({ context, registerCleanup }) => {
	test.setTimeout(60_000);
	const f = await openPlugins(registerCleanup);
	const plugin = await f.install('browser', { modelApp: true, capabilities: ['plugin.invoke', 'context.read'] });
	await plugin.grants(['plugin.invoke', 'context.read']);
	const b = await openPluginBrowser(registerCleanup, context, f, plugin);
	let frame;

	await test.step('all actual SDK dependencies load and opaque sandbox cannot read parent cookie', async () => {
		frame = await b.frame();
		assert.deepEqual(
			b.requests.filter((item) => item.status !== 200),
			[],
		);
		assert.deepEqual(
			b.requests.filter((item) => item.path.startsWith('/sdk/')),
			[{ path: '/sdk/frontend-v4.mjs', status: 200 }],
		);
		assert.deepEqual(b.errors, []);
		assert.equal(
			await frame.evaluate(() => {
				try {
					return document.cookie;
				} catch (error) {
					return error.name;
				}
			}),
			'SecurityError',
		);
		assert.equal(await b.page.evaluate(() => window.bridge.acks.length), 1);
		const info = await frame.evaluate(() => window.sdk.request({ method: 'host.appInfo', params: {} }));
		assert.deepEqual(info.value, plugin.installation);
	});
	await test.step('SDK storage uses actual host persistence, stable operation ID replay and CAS refusal', async () => {
		const input = {
			method: 'storage.put',
			params: { key: 'browser', expectedVersion: 0, operationId: randomUUID(), valueJson: '{"message":"界面"}' },
		};
		const first = await frame.evaluate((input) => window.sdk.request(input), input);
		assert.equal(first.value.version, 1);
		assert.deepEqual(await frame.evaluate((input) => window.sdk.request(input), input), first);
		const read = expectStatus(
			await f.api('GET', '/api/v1/agent/plugins/installations/' + plugin.appId + '/data/browser'),
			200,
		);
		assert.deepEqual(read.value, first.value);
		const refusal = await frame.evaluate(
			async (input) => {
				try {
					await window.sdk.request(input);
				} catch (error) {
					return { code: error.code, unknown: error.outcomeUnknown };
				}
			},
			{ ...input, params: { ...input.params, operationId: randomUUID() } },
		);
		assert.deepEqual(refusal, { code: 'version_conflict', unknown: false });
	});
	await test.step('SDK creates, lists and renames actual threads with explicit CAS', async () => {
		const thread = await frame.evaluate(
			(operationId) =>
				window.sdk.request({
					method: 'agent.threads.create',
					params: { autoTitle: false, operationId, title: 'SDK thread' },
				}),
			randomUUID(),
		);
		const renamed = await frame.evaluate(
			({ thread, operationId }) =>
				window.sdk.request({
					method: 'agent.threads.rename',
					params: { threadId: thread.id, expectedVersion: thread.version, operationId, title: 'renamed' },
				}),
			{ thread: thread.value, operationId: randomUUID() },
		);
		assert.equal(renamed.value.title, 'renamed');
		assert.equal(renamed.value.appId, plugin.appId);
		const listed = await frame.evaluate(() =>
			window.sdk.request({ method: 'agent.threads.list', params: { after: null, limit: 10 } }),
		);
		assert.deepEqual(listed.value.items, [renamed.value]);
	});
	await test.step('self-posted fake init is ignored; actual parent handoff still succeeds', async () => {
		await frame.evaluate(() => window.sdk.close());
		frame = await b.frame({ holdInit: true });
		await frame.evaluate(
			({ nonce, appId }) => {
				const channel = new MessageChannel();
				window.postMessage(
					{ type: 'nexus.plugin.init', protocol: 4, nonce, appId, expiresAt: Date.now() + 60000 },
					'*',
					[channel.port2],
				);
				channel.port1.close();
			},
			{ nonce: randomUUID(), appId: plugin.appId },
		);
		assert.equal(await frame.evaluate(() => Boolean(window.sdk)), false);
		await b.page.evaluate(() => window.initializePlugin());
		await frame.waitForFunction(() => window.sdk);
		assert.equal(
			(await frame.evaluate(() => window.sdk.request({ method: 'host.appInfo', params: {} }))).value.appId,
			plugin.appId,
		);
	});
	await test.step('wrong app in a valid correlated reply closes the SDK without leaking identity', async () => {
		await b.page.evaluate(() => {
			window.bridge.corrupt = 'app';
		});
		const failed = await frame.evaluate(async () => {
			try {
				await window.sdk.request({ method: 'host.appInfo', params: {} });
			} catch (error) {
				return { code: error.code, unknown: error.outcomeUnknown };
			}
		});
		assert.deepEqual(failed, { code: 'provider_unavailable', unknown: false });
		await frame.evaluate(() => window.sdk.close());
		frame = await b.frame();
	});
	await test.step('response corruption after a real write keeps operation unknown and original ID, without replay', async () => {
		await b.page.evaluate(() => {
			window.bridge.corrupt = 'nonce';
		});
		const input = {
			method: 'storage.put',
			params: { key: 'unknown', expectedVersion: 0, operationId: randomUUID(), valueJson: '"committed"' },
		};
		const failed = await frame.evaluate(async (input) => {
			try {
				await window.sdk.request(input);
			} catch (error) {
				return { code: error.code, unknown: error.outcomeUnknown, operationId: error.operationId };
			}
		}, input);
		assert.deepEqual(failed, {
			code: 'operation_unknown',
			unknown: true,
			operationId: input.params.operationId,
		});
		assert.equal(
			b.deliveries.filter((item) => item.envelope.request.params.operationId === input.params.operationId).length,
			1,
		);
		const persisted = expectStatus(
			await f.api('GET', '/api/v1/agent/plugins/installations/' + plugin.appId + '/data/unknown'),
			200,
		).value;
		assert.equal(persisted.valueJson, '"committed"');
		await frame.evaluate(() => window.sdk.close());
		frame = await b.frame();
		assert.deepEqual((await frame.evaluate((input) => window.sdk.request(input), input)).value, persisted);
	});
	await test.step('concurrent held replies exceed the old pending threshold and close with their original owner', async () => {
		await b.page.evaluate(() => {
			window.bridge.hold = true;
		});
		await frame.evaluate(() => {
			window.pending = Array.from({ length: 33 }, () =>
				window.sdk.request({ method: 'storage.get', params: { key: 'browser' } }).then(
					() => 'ok',
					(error) => error.code,
				),
			);
		});
		await b.page.waitForFunction(() => window.bridge.queued.length === 33);
		assert.deepEqual(
			await frame.evaluate(async () => {
				await window.sdk.close();
				return Promise.all(window.pending);
			}),
			Array(33).fill('provider_unavailable'),
		);
		frame = await b.frame();
	});
	await test.step('real WS denial reaches subscription failure and unsubscribe closes it', async () => {
		const runId = randomUUID();
		const result = await frame.evaluate(async (runId) => {
			const failures = [];
			const subscription = window.sdk.agent.runs.subscribe(
				runId,
				0,
				() => {
					throw new Error('must not deliver');
				},
				(error) => {
					failures.push(error.code);
				},
			);
			await subscription.closed;
			await window.sdk.agent.runs.unsubscribe(subscription.id);
			await window.sdk.close();
			return failures;
		}, runId);
		assert.deepEqual(result, ['not_found']);
	});
	let run;
	await test.step('SDK creates a real model Run and streams its actual events with the server cursor', async () => {
		frame = await b.frame();
		const provider = expectStatus(
			await f.api('POST', '/api/v1/agent/ai/providers', {
				kind: 'openai-compatible',
				displayName: 'SDK provider',
				baseUrl: b.modelUrl,
				protocol: 'chat-completions',
				models: [{ id: 'fixture', contextWindow: 8192, maxOutputTokens: 256, supportsTools: false }],
				enabled: true,
				credential: 'isolated-sdk-key',
			}),
			201,
		);
		const settings = expectStatus(await f.api('GET', '/api/v1/agent/execution-settings'), 200).settings;
		expectStatus(
			await f.api('PUT', '/api/v1/agent/execution-settings', {
				expectedVersion: settings.version,
				enabled: true,
				limits: settings.limits,
			}),
			200,
		);
		const thread = (
			await frame.evaluate(
				(operationId) =>
					window.sdk.request({
						method: 'agent.threads.create',
						params: { autoTitle: false, operationId, title: 'subscription' },
					}),
				randomUUID(),
			)
		).value;
		run = (
			await frame.evaluate(
				({ threadId, operationId, model }) =>
					window.sdk.request({
						method: 'agent.runs.create',
						params: {
							threadId,
							operationId,
							input: {
								prompt: 'subscription',
								approvalMode: 'ask',
								connectionIds: [],
								inputJson: JSON.stringify({
									model: { ...model, reasoningEffort: null },
									artifacts: [],
								}),
							},
						},
					}),
				{
					threadId: thread.id,
					operationId: randomUUID(),
					model: { providerId: provider.id, modelId: 'fixture', configurationVersion: provider.version },
				},
			)
		).value.run;
		await until(
			async () => expectStatus(await f.api('GET', plugin.appPath + '/runs/' + run.id), 200),
			(value) => value.status === 'completed',
			'SDK model Run completion',
		);
		assert.equal(b.modelCalls.length, 1);
		await frame.evaluate((runId) => {
			window.pages = [];
			window.failures = [];
			window.sub = window.sdk.agent.runs.subscribe(
				runId,
				0,
				(page) => {
					window.pages.push(page);
				},
				(error) => {
					window.failures.push(error.message);
				},
			);
		}, run.id);
		await frame.waitForFunction(() => window.pages.length > 0);
		const first = await frame.evaluate(() => window.pages[0]);
		assert.ok(first.items.every((item) => item.runId === run.id));
		assert.ok(first.items.length > 0);
		await b.page.waitForFunction(() =>
			window.bridge.requests.some(
				(item) => item.type === 'nexus.plugin.stream' && item.command === 'ack' && item.revision === 1,
			),
		);
		await frame.evaluate(() => window.sdk.agent.runs.unsubscribe(window.sub.id));
		await frame.evaluate(
			({ runId, after }) => {
				window.resumed = [];
				window.sub = window.sdk.agent.runs.subscribe(
					runId,
					after,
					(page) => window.resumed.push(page),
					() => {},
				);
			},
			{ runId: run.id, after: first.nextCursor },
		);
		const resumedId = await frame.evaluate(() => window.sub.id);
		await b.page.waitForFunction(
			(id) =>
				window.bridge.requests.some(
					(item) =>
						item.type === 'nexus.plugin.stream' && item.subscriptionId === id && item.command === 'ack',
				),
			resumedId,
		);
		assert.deepEqual(
			await b.page.evaluate(
				(id) => window.bridge.streamReplies.find((item) => item.subscriptionId === id).value,
				resumedId,
			),
			{ items: [], nextCursor: first.nextCursor },
		);
		assert.deepEqual(
			await frame.evaluate(() => window.resumed),
			[],
			'empty catch-up pages do not repeat consumer callbacks',
		);
		await frame.evaluate(() => window.sdk.agent.runs.unsubscribe(window.sub.id));
		assert.equal(b.modelCalls.length, 1, 'stream recovery never resubmits the accepted model Run');
		assert.deepEqual(await frame.evaluate(() => window.failures), []);
	});
	await test.step('unsubscribe waits an already running asynchronous consumer callback', async () => {
		await frame.evaluate((runId) => {
			window.delivering = false;
			window.stopped = false;
			window.sub = window.sdk.agent.runs.subscribe(
				runId,
				0,
				() =>
					new Promise((resolve) => {
						window.delivering = true;
						window.releaseConsumer = resolve;
					}),
				() => {},
			);
		}, run.id);
		await frame.waitForFunction(() => window.delivering);
		await frame.evaluate(() => {
			window.stopTask = window.sdk.agent.runs.unsubscribe(window.sub.id).then(() => {
				window.stopped = true;
			});
		});
		assert.equal(await frame.evaluate(() => window.stopped), false);
		await frame.evaluate(async () => {
			window.releaseConsumer();
			await window.stopTask;
		});
		assert.equal(await frame.evaluate(() => window.stopped), true);
	});
	await test.step('consumer callback rejection reaches failure handler and settles the original subscription', async () => {
		const result = await frame.evaluate(async (runId) => {
			const failures = [];
			const sub = window.sdk.agent.runs.subscribe(
				runId,
				0,
				() => {
					throw new Error('isolated callback failure');
				},
				(error) => {
					failures.push(error.message);
				},
			);
			await sub.closed;
			return failures;
		}, run.id);
		assert.deepEqual(result, ['isolated callback failure']);
	});
	await test.step('nine subscriptions retain independent ownership beyond the old threshold', async () => {
		await b.page.evaluate(() => {
			window.bridge.hold = true;
		});
		await frame.evaluate((runId) => {
			window.subs = Array.from({ length: 9 }, () =>
				window.sdk.agent.runs.subscribe(
					runId,
					0,
					() => {},
					() => {},
				),
			);
		}, run.id);
		const ids = await frame.evaluate(() => window.subs.map((sub) => sub.id));
		await b.page.waitForFunction(
			(ids) => ids.every((id) => window.bridge.queued.some((event) => event.subscriptionId === id)),
			ids,
		);
		assert.equal(ids.length, 9);
		await frame.evaluate(() => Promise.all(window.subs.map((sub) => window.sdk.agent.runs.unsubscribe(sub.id))));
		await b.page.evaluate(() => {
			for (const response of window.bridge.queued) window.bridge.port.postMessage(response);
			window.bridge.queued = [];
			window.bridge.hold = false;
		});
	});
	await test.step('late held event response after unsubscribe does not reach the stopped callback', async () => {
		await b.page.evaluate(() => {
			window.bridge.hold = true;
		});
		await frame.evaluate((runId) => {
			window.lateCount = 0;
			window.sub = window.sdk.agent.runs.subscribe(
				runId,
				0,
				() => {
					window.lateCount++;
				},
				() => {},
			);
		}, run.id);
		await b.page.waitForFunction(() => window.bridge.queued.length >= 1);
		await frame.evaluate(() => window.sdk.agent.runs.unsubscribe(window.sub.id));
		await b.page.evaluate(() => {
			window.bridge.port.postMessage(window.bridge.queued[0]);
			window.bridge.queued = [];
			window.bridge.hold = false;
		});
		await frame.evaluate(() => window.sdk.request({ method: 'host.appInfo', params: {} }));
		assert.equal(await frame.evaluate(() => window.lateCount), 0);
	});
	await test.step('failure-handler rejection is retained and concurrent SDK closes share the same failed Promise', async () => {
		const result = await frame.evaluate(async (runId) => {
			const sub = window.sdk.agent.runs.subscribe(
				runId,
				0,
				() => {
					throw new Error('consumer failed');
				},
				() => {
					throw new Error('failure handler failed');
				},
			);
			let subscriptionFailure;
			try {
				await sub.closed;
			} catch (error) {
				subscriptionFailure = error.errors.map((item) => item.message);
			}
			const first = window.sdk.close();
			const second = window.sdk.close();
			let closeFailure;
			try {
				await first;
			} catch (error) {
				closeFailure = error.errors[0].errors.map((item) => item.message);
			}
			await second.catch(() => {});
			return { same: first === second, subscriptionFailure, closeFailure };
		}, run.id);
		assert.deepEqual(result, {
			same: true,
			subscriptionFailure: ['consumer failed', 'failure handler failed'],
			closeFailure: ['consumer failed', 'failure handler failed'],
		});
	});
});
