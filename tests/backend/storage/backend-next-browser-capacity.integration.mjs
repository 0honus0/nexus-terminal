import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { NativeBrowserClient } from '../../../packages/backend/dist/platform/browser/adapters/native-browser-client.js';
const backend = createRequire(new URL('../../../packages/backend/package.json', import.meta.url));
const e2e = createRequire(new URL('../../e2e/package.json', import.meta.url));

await test(
	'Browser capacity: deep DOM, wide queues and complete fields use the caller snapshot byte budget',
	{ timeout: 30000 },
	async (t) => {
		let browser, session;
		t.after(async () => {
			const failures = [];
			for (const close of [
				() => session?.close(),
				() => browser?.close(),
				() => new Promise((resolve, reject) => site.close((error) => (error ? reject(error) : resolve()))),
			])
				try {
					await close();
				} catch (error) {
					failures.push(error);
				}
			if (failures.length) throw new AggregateError(failures, 'Browser capacity cleanup failed');
		});
		const site = createServer((request, response) => {
			response.setHeader('Content-Type', 'text/html; charset=utf-8');
			response.end(
				request.url === '/deep'
					? '<!doctype html><title>Deep</title>' +
							'<div>'.repeat(24) +
							'<button id="deep" title="' +
							'attribute'.repeat(500) +
							'">' +
							'content'.repeat(500) +
							'</button>' +
							'</div>'.repeat(24)
					: '<!doctype html><title>Wide</title><main>' +
							Array.from(
								{ length: 5000 },
								(_, index) => '<button id="wide' + index + '">value</button>',
							).join('') +
							'</main>',
			);
		});
		site.listen(0, '127.0.0.1');
		await once(site, 'listening');
		const puppeteer = backend('puppeteer-core');
		browser = await puppeteer.launch({
			executablePath: e2e('@playwright/test').chromium.executablePath(),
			headless: true,
			args: ['--no-sandbox'],
		});
		const origin = 'http://127.0.0.1:' + site.address().port;
		const signal = new AbortController().signal;
		session = await new NativeBrowserClient().connect(
			{
				endpoint: browser.wsEndpoint(),
				verifyTls: true,

				allowUrl: (url) => url.startsWith(origin + '/'),
			},
			signal,
		);
		await session.perform({ kind: 'navigate', url: origin + '/deep', settleMs: 0 }, signal);
		const deep = await session.snapshot(20000, 2 * 1024 * 1024, signal);
		const button = deep.nodes.find((node) =>
			node.attributes.some((attribute) => attribute.name === 'id' && attribute.value === 'deep'),
		);
		assert.ok(button, 'a target below 24 containers remains reachable');
		assert.equal(button.attributes.find((attribute) => attribute.name === 'title').value, 'attribute'.repeat(500));
		assert.ok(deep.nodes.some((node) => node.parentRef === button.ref && node.text === 'content'.repeat(500)));
		assert.equal(deep.truncated, false);
		await session.perform({ kind: 'click', snapshotId: deep.snapshotId, nodeRef: button.ref, settleMs: 0 }, signal);
		await assert.rejects(
			session.perform({ kind: 'click', snapshotId: deep.snapshotId, nodeRef: button.ref, settleMs: 0 }, signal),
			(error) => error.kind === 'stale_snapshot',
		);
		await session.perform({ kind: 'navigate', url: origin + '/wide', settleMs: 0 }, signal);
		const wide = await session.snapshot(20000, 2 * 1024 * 1024, signal);
		assert.equal(wide.nodes.filter((node) => node.tag === 'BUTTON').length, 5000);
		assert.equal(wide.truncated, false);
		const limited = await session.snapshot(20000, 128 * 1024, signal);
		assert.equal(limited.truncated, true);
		assert.ok(Buffer.byteLength(JSON.stringify(limited)) <= 128 * 1024);
		assert.ok(limited.nodes.length > 0);
		await assert.rejects(session.snapshot(20000, 1, signal), (error) => error.kind === 'limit_exceeded');
	},
);
