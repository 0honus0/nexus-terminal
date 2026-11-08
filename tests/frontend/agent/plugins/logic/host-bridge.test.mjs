// @vitest-environment jsdom
import { once } from 'node:events';
import { MessageChannel } from 'node:worker_threads';
import { test, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { PluginFrontendHostBridge } from '../../../../../packages/frontend/src/features/agent/plugins/host/host-bridge.ts';
import { pendingPluginConfiguration } from '../../../../../packages/frontend/src/features/agent/plugins/api/plugin-configuration-writes.ts';
import { authenticatedSessionLifecycle } from '../../../../../packages/frontend/src/shared/session/authenticatedSessionLifecycle.ts';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => {
	authenticatedSessionLifecycle.dispose();
	server.resetHandlers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

for (const [code, status, expected] of [
	['version_conflict', 409, 'version_conflict'],
	['forbidden', 403, 'forbidden'],
	['not_found', 404, 'not_found'],
	['storage_unavailable', 503, 'operation_unknown'],
]) {
	test(
		'settings Surface preserves ' + code + ' and the original write certainty through its real MessagePort',
		async () => {
			server.use(
				http.post(
					'http://localhost/api/v1/agent/plugins/installations/:appId/frontend/rpc',
					async ({ request }) => {
						const { envelope } = await request.json();
						return HttpResponse.json(
							{
								type: 'nexus.plugin.response',
								protocol: 4,
								nonce: envelope.nonce,
								id: envelope.id,
								seq: envelope.seq,
								ok: false,
								error: { code },
							},
							{ status },
						);
					},
				),
			);
			vi.stubGlobal('MessageChannel', MessageChannel);
			const iframe = document.createElement('iframe');
			document.body.append(iframe);
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
			let peer;
			let nonce;
			vi.spyOn(iframe.contentWindow, 'postMessage').mockImplementation((message, _origin, ports) => {
				nonce = message.nonce;
				peer = ports[0];
				peer.postMessage({ type: 'nexus.plugin.ack', protocol: 4, nonce, seq: 0 });
			});
			try {
				const ready = bridge.start();
				// Only iframe presentation is substituted; the production bridge and both MessagePorts are real.
				// Actual browser frame identity/origin isolation remains in the signed sandbox protocol suite.
				window.dispatchEvent(
					new MessageEvent('message', {
						source: iframe.contentWindow,
						data: { type: 'nexus.plugin.ready', protocol: 4 },
					}),
				);
				await ready;
				const requestId = crypto.randomUUID();
				const reply = once(peer, 'message');
				const command = {
					operationKey: crypto.randomUUID(),
					expectedPackageRevision: 1,
					expectedRevision: 0,
					schemaRevision: 1,
					documentJson: '{}',
				};
				peer.postMessage({
					type: 'nexus.plugin.request',
					protocol: 4,
					nonce,
					id: requestId,
					seq: 1,
					request: { method: 'settings.write', params: command },
				});
				const [result] = await reply;
				expect(result).toMatchObject({ ok: false, error: { code: expected }, id: requestId, seq: 1, nonce });
				expect(pendingPluginConfiguration(id, id)).toEqual(expected === 'operation_unknown' ? command : null);
			} finally {
				await bridge.close();
				peer?.close();
				iframe.remove();
			}
		},
	);
}
