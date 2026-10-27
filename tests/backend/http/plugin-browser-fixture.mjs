import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { expectStatus } from '../remote/openssh-fixture.mjs';

const { chromium } = createRequire(new URL('../../e2e/package.json', import.meta.url))('@playwright/test');

/** Test-only parent bridges actual MessagePort traffic to the installed RPC HTTP route. */
export async function openPluginBrowser(t, f, plugin) {
	const requests = [];
	const modelCalls = [];
	const failures = [];
	let browser;
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
		for (const close of [
			() => browser?.close(),
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
		return (await f.api('POST', installPath + '/frontend/rpc', input)).body;
	});
	await page.goto('http://127.0.0.1:' + server.address().port);

	async function frame(options = {}) {
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
					hold: false,
					corrupt: null,
					requests: [],
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
						const response = await window.actualPluginRpc({
							grant: descriptor.url.split('/')[4],
							envelope: event.data,
						});
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
						{ type: 'nexus.plugin.init', protocol: 1, nonce, appId: descriptor.appId },
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
		modelUrl: 'http://127.0.0.1:' + server.address().port + '/provider/v1',
	};
}
