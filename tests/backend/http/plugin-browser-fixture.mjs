import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { expectStatus } from '../remote/openssh-fixture.mjs';

const { chromium } = createRequire(new URL('../../e2e/package.json', import.meta.url))('@playwright/test');

/** Test-only parent bridges actual MessagePort traffic to the installed RPC HTTP route. */
export async function openPluginBrowser(t, f, plugin, options = {}) {
	const requests = [];
	const modelCalls = [];
	const failures = [];
	let browser;
	let streamSocket;
	let streamReady;
	const streamOwners = new Map();
	const rpcOwners = new Map();
	const heldModels = new Set();
	const server = createServer((request, response) => {
		void (async () => {
			if (request.url === '/provider/v1/chat/completions') {
				const chunks = [];
				let size = 0;
				for await (const chunk of request) {
					size += chunk.length;
					if (size > 128 * 1024) {
						throw new Error('Fixture model request exceeded budget');
					}
					chunks.push(chunk);
				}
				modelCalls.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
				response.writeHead(200, { 'Content-Type': 'text/event-stream' });
				if (options.holdModel) {
					response.write(
						'data: ' +
							JSON.stringify({
								choices: [{ index: 0, delta: { content: 'UI update prefix ' }, finish_reason: null }],
							}) +
							'\n\n',
					);
					heldModels.add(response);
					response.once('close', () => heldModels.delete(response));
					return;
				}
				response.end(
					'data: ' +
						JSON.stringify({
							choices: [
								{ index: 0, delta: { content: 'SDK subscription complete' }, finish_reason: null },
							],
						}) +
						'\n\ndata: ' +
						JSON.stringify({
							choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
							usage: { prompt_tokens: 10, completion_tokens: 3 },
						}) +
						'\n\ndata: [DONE]\n\n',
				);
				return;
			}
			if (request.url === '/') {
				response.writeHead(200, { 'Content-Type': 'text/html' });
				response.end('<!doctype html><title>isolated SDK parent</title>');
				return;
			}
			const result = await f.anonymous('GET', request.url);
			requests.push({ path: request.url, status: result.status });
			response.writeHead(result.status, result.headers);
			response.end(result.bytes);
		})().catch((error) => {
			failures.push(error);
			response.destroy();
		});
	});
	t.after(async () => {
		const cleanup = [];
		for (const response of heldModels) response.destroy();
		for (const close of [
			() => browser?.close(),
			async () => {
				if (!streamSocket || streamSocket.readyState === 3) return;
				const closed = once(streamSocket, 'close');
				streamSocket.terminate();
				await closed;
			},
			() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
		]) {
			try {
				await close();
			} catch (error) {
				cleanup.push(error);
			}
		}
		if (failures.length || cleanup.length) {
			throw new AggregateError([...failures, ...cleanup], 'Plugin browser fixture failed');
		}
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') {
			errors.push(message.text());
		}
	});
	const installPath = '/api/v1/agent/plugins/installations/' + plugin.appId;
	const deliveries = [];
	await page.exposeFunction('actualPluginRpc', async (input) => {
		deliveries.push(input);
		const abort = new AbortController();
		const owner = { abort, nonce: input.envelope.nonce };
		rpcOwners.set(input.envelope.id, owner);
		try {
			return (await f.api('POST', installPath + '/frontend/rpc', input, undefined, { signal: abort.signal }))
				.body;
		} catch (error) {
			if (abort.signal.aborted) return null;
			throw error;
		} finally {
			if (rpcOwners.get(input.envelope.id) === owner) rpcOwners.delete(input.envelope.id);
		}
	});
	await page.exposeFunction('actualPluginControl', async (command) => {
		if (command.type === 'nexus.plugin.cancel') {
			const owner = rpcOwners.get(command.id);
			if (owner?.nonce === command.nonce) owner.abort.abort();
			return;
		}
		for (const owner of rpcOwners.values()) if (owner.nonce === command.nonce) owner.abort.abort();
		for (const [subscriptionId, owner] of streamOwners) {
			if (owner.nonce !== command.nonce) continue;
			if (streamSocket?.readyState === 1)
				streamSocket.send(
					JSON.stringify({ type: 'unsubscribe', subscriptionId, generation: owner.generation }),
				);
			streamOwners.delete(subscriptionId);
		}
		if (streamSocket && streamOwners.size === 0) {
			const previous = streamSocket;
			streamSocket = undefined;
			const closed = once(previous, 'close');
			previous.terminate();
			await closed;
		}
	});
	await page.exposeFunction('actualPluginStream', async ({ grant, envelope }) => {
		if (!streamSocket) {
			streamSocket = f.socket('/ws/agent-runs');
			streamReady = once(streamSocket, 'open');
			streamSocket.on('message', (bytes) => {
				const frame = JSON.parse(bytes.toString());
				if (frame.type === 'heartbeat') return;
				const owner = streamOwners.get(frame.subscriptionId);
				if (!owner || owner.generation !== frame.generation) return;
				const event =
					frame.type === 'data'
						? {
								type: 'nexus.plugin.stream-event',
								protocol: 4,
								nonce: owner.nonce,
								subscriptionId: frame.subscriptionId,
								generation: frame.generation,
								ok: true,
								revision: frame.revision,
								value: frame.value,
							}
						: {
								type: 'nexus.plugin.stream-event',
								protocol: 4,
								nonce: owner.nonce,
								subscriptionId: frame.subscriptionId,
								generation: frame.generation,
								ok: false,
								error: {
									code:
										frame.code === 'forbidden'
											? 'forbidden'
											: frame.code === 'resync_required'
												? 'not_found'
												: 'provider_unavailable',
								},
							};
				void page
					.evaluate(
						({ event, nonce }) => {
							const state = window.bridge;
							if (!state || state.nonce !== nonce) return;
							state.streamReplies.push(event);
							if (state.hold) state.queued.push(event);
							else state.port.postMessage(event);
						},
						{ event, nonce: owner.nonce },
					)
					.catch((error) => failures.push(error));
			});
		}
		await streamReady;
		const { subscriptionId, generation } = envelope;
		if (envelope.command === 'subscribe') {
			streamOwners.set(subscriptionId, { generation, nonce: envelope.nonce });
			streamSocket.send(
				JSON.stringify({
					type: 'subscribe',
					subscriptionId,
					generation,
					source: { ...envelope.source, appId: plugin.appId, grant },
				}),
			);
		} else {
			streamSocket.send(
				JSON.stringify({
					type: envelope.command,
					subscriptionId,
					generation,
					...(envelope.command === 'ack' ? { revision: envelope.revision } : {}),
				}),
			);
			if (envelope.command === 'unsubscribe') streamOwners.delete(subscriptionId);
		}
	});
	await page.goto('http://127.0.0.1:' + server.address().port);

	async function frame(options = {}) {
		for (const [subscriptionId, owner] of streamOwners) {
			streamSocket.send(JSON.stringify({ type: 'unsubscribe', subscriptionId, generation: owner.generation }));
		}
		streamOwners.clear();
		const descriptor = expectStatus(await f.api('GET', installPath + '/descriptor'), 200);
		await page.evaluate(
			({ descriptor, nonce, holdInit }) => {
				document.querySelector('iframe')?.remove();
				if (window.receiveReady) {
					window.removeEventListener('message', window.receiveReady);
				}
				const iframe = document.createElement('iframe');
				iframe.sandbox = descriptor.sandbox;
				const state = {
					nonce,
					hold: false,
					corrupt: null,
					requests: [],
					streamReplies: [],
					acks: [],
					queued: [],
					ready: false,
					initialized: false,
				};
				window.bridge = state;
				window.initializePlugin = () => {
					if (state.initialized) {
						throw new Error('Already initialized');
					}
					state.initialized = true;
					const channel = new MessageChannel();
					state.port = channel.port1;
					channel.port1.onmessage = async (event) => {
						if (event.data.type === 'nexus.plugin.ack') {
							state.acks.push(event.data);
							return;
						}
						state.requests.push(event.data);
						if (event.data.type === 'nexus.plugin.cancel' || event.data.type === 'nexus.plugin.close') {
							await window.actualPluginControl(event.data);
							if (event.data.type === 'nexus.plugin.close') channel.port1.close();
							return;
						}
						if (event.data.type === 'nexus.plugin.stream') {
							await window.actualPluginStream({
								grant: descriptor.url.split('/')[4],
								envelope: event.data,
							});
							return;
						}
						const response = await window.actualPluginRpc({
							grant: descriptor.url.split('/')[4],
							envelope: event.data,
						});
						if (response === null) return;
						if (state.corrupt === 'nonce') {
							response.nonce = crypto.randomUUID();
						}
						if (state.corrupt === 'app') {
							response.result.value.appId = crypto.randomUUID();
						}
						if (state.hold) {
							state.queued.push(response);
						} else {
							channel.port1.postMessage(response);
						}
					};
					iframe.contentWindow.postMessage(
						{
							type: 'nexus.plugin.init',
							protocol: 4,
							nonce,
							appId: descriptor.appId,
							expiresAt: descriptor.expiresAt,
						},
						'*',
						[channel.port2],
					);
				};
				window.receiveReady = (event) => {
					if (event.source !== iframe.contentWindow || event.data.type !== 'nexus.plugin.ready') {
						return;
					}
					state.ready = true;
					if (!holdInit) {
						window.initializePlugin();
					}
				};
				window.addEventListener('message', window.receiveReady);
				iframe.src = descriptor.url;
				document.body.append(iframe);
			},
			{ descriptor, nonce: randomUUID(), holdInit: options.holdInit === true },
		);
		await page
			.waitForFunction(() => window.bridge.ready, { timeout: 10000 })
			.catch((error) => {
				throw new AggregateError([error], 'SDK failed before ready: ' + JSON.stringify({ errors, requests }));
			});
		const child = page.frames().find((frame) => frame.url().includes('/plugins/'));
		assert.ok(child);
		if (!options.holdInit) {
			await child.waitForFunction(() => window.sdk, { timeout: 10000 });
		}
		return child;
	}

	return {
		page,
		frame,
		requests,
		errors,
		deliveries,
		modelCalls,

		get heldModelCount() {
			return heldModels.size;
		},

		finishModels() {
			for (const response of heldModels)
				response.end(
					'data: ' +
						JSON.stringify({
							choices: [
								{ index: 0, delta: { content: 'SDK subscription complete' }, finish_reason: null },
							],
						}) +
						'\n\ndata: ' +
						JSON.stringify({
							choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
							usage: { prompt_tokens: 10, completion_tokens: 3 },
						}) +
						'\n\ndata: [DONE]\n\n',
				);
		},

		modelUrl: 'http://127.0.0.1:' + server.address().port + '/provider/v1',
	};
}
