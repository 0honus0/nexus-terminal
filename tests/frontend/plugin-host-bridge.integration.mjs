import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';

const { chromium } = createRequire(new URL('../e2e/package.json', import.meta.url))('@playwright/test');
let vite, browser, directory;
before(async () => {
	directory = await mkdtemp(join(tmpdir(), 'plugin-host-bridge-'));
	vite = await createServer({
		root: fileURLToPath(new URL('../../packages/frontend', import.meta.url)),
		configFile: fileURLToPath(new URL('../../packages/frontend/vite.config.ts', import.meta.url)),
		cacheDir: join(directory, 'vite'),
		logLevel: 'error',
		server: { host: '127.0.0.1', port: 0, strictPort: true, open: false },
		plugins: [
			{
				name: 'host-bridge-fixture',

				configureServer(server) {
					server.middlewares.use('/bridge-fixture', (_request, response) => {
						response.setHeader('Content-Type', 'text/html');
						response.end('<!doctype html><title>Host bridge</title>');
					});
				},
			},
		],
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
});
after(async () => {
	const results = await Promise.allSettled([browser?.close(), vite?.close()]);
	await rm(directory, { recursive: true, force: true });
	const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
	if (failures.length) throw new AggregateError(failures, 'Bridge fixture cleanup failed');
});

for (const [code, status, expected] of [
	['version_conflict', 409, 'version_conflict'],
	['forbidden', 403, 'forbidden'],
	['not_found', 404, 'not_found'],
	['storage_unavailable', 503, 'operation_unknown'],
]) {
	test('Settings Surface preserves ' + code + ' without losing its dispatch certainty', async (t) => {
		const page = await browser.newPage();
		t.after(() => page.close());
		await page.route('**/api/v1/agent/plugins/installations/*/frontend/rpc', async (route) => {
			const { envelope } = route.request().postDataJSON();
			await route.fulfill({
				status,
				json: {
					type: 'nexus.plugin.response',
					protocol: 4,
					nonce: envelope.nonce,
					id: envelope.id,
					seq: envelope.seq,
					ok: false,
					error: { code },
				},
			});
		});
		await page.goto('http://127.0.0.1:' + vite.httpServer.address().port + '/bridge-fixture');
		const reply = await page.evaluate(async () => {
			const { PluginFrontendHostBridge } = await import('/src/features/agent/plugins/host/host-bridge.ts');
			const iframe = document.createElement('iframe');
			iframe.srcdoc = `<script>
window.addEventListener('message', event => {
 if(event.source !== parent || event.data.type !== 'nexus.plugin.init') return;
 const port=event.ports[0], nonce=event.data.nonce;
 port.onmessage=event=>window.resolveReply(event.data);
 window.send=request=>new Promise(resolve=>{
  window.resolveReply=resolve;
  port.postMessage({type:'nexus.plugin.request',protocol:4,nonce,id:crypto.randomUUID(),seq:1,request});
 });
 port.postMessage({type:'nexus.plugin.ack',protocol:4,nonce,seq:0});
});
parent.postMessage({type:'nexus.plugin.ready',protocol:4},'*');
</script>`;
			const id = crypto.randomUUID();
			const bridge = new PluginFrontendHostBridge(iframe, {
				purpose: 'settings',
				appId: id,
				instanceId: id,
				grant: crypto.randomUUID(),
				expiresAt: Date.now() + 600000,
				requestTimeoutMs: 30000,
				maxMessageBytes: 512 * 1024,
			});
			const ready = bridge.start();
			document.body.append(iframe);
			await ready;
			try {
				return await iframe.contentWindow.send({
					method: 'settings.write',
					params: {
						operationKey: crypto.randomUUID(),
						expectedPackageRevision: 1,
						expectedRevision: 0,
						schemaRevision: 1,
						documentJson: '{}',
					},
				});
			} finally {
				await bridge.close();
			}
		});
		assert.equal(reply.ok, false);
		assert.deepEqual(reply.error, { code: expected });
	});
}
