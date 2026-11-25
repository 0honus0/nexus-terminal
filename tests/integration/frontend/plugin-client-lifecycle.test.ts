import { afterEach, expect, it, vi } from 'vitest';
import { PluginScope } from '../../../src/plugin/plugin-api.js';
import { WsClientService } from '../../../src/ws/browser/ws-plugin-client-api.js';
import { HttpClientService } from '../../../src/http/browser/http-plugin-client-api.js';
import { TaskService } from '../../../src/task/browser/task-plugin-api.js';
import type { PluginViewApi } from '../../../src/plugin/browser/plugin-view-api.js';
import type { UseWebSocketOptions } from '@vueuse/core';

const mock = vi.hoisted(() => ({
	options: undefined as UseWebSocketOptions | undefined,
	ws: { value: undefined as WebSocket | undefined },
	close: vi.fn(),
	send: vi.fn(() => true),
}));
vi.mock('@vueuse/core', () => ({
	useWebSocket(_url: string, options: UseWebSocketOptions) {
		mock.options = options;
		return {
			ws: mock.ws,
			close: mock.close,
			send: mock.send,
			data: { value: null },
			status: { value: 'OPEN' },

			open() {},
		};
	},
}));
afterEach(() => vi.unstubAllGlobals());

it('ignores socket events after explicit close and from a replaced socket', async () => {
	const scope = new PluginScope(() => {});
	const onError = vi.fn(),
		onDisconnected = vi.fn(),
		onMessage = vi.fn();
	try {
		const first = {} as WebSocket;
		const next = {} as WebSocket;
		mock.ws.value = first;
		const stream = new WsClientService()
			.bind('@test/fixture', scope)
			.connect('echo', { onError, onDisconnected, onMessage });
		mock.ws.value = next;
		mock.options!.onError!(first, new Event('error'));
		mock.options!.onDisconnected!(first, new CloseEvent('close'));
		mock.options!.onMessage!(next, new MessageEvent('message', { data: 'current' }));
		expect(onMessage).toHaveBeenCalledOnce();
		expect(onError).not.toHaveBeenCalled();
		expect(onDisconnected).not.toHaveBeenCalled();
		stream.close();
		mock.options!.onError!(next, new Event('error'));
		mock.options!.onDisconnected!(next, new CloseEvent('close'));
		mock.options!.onMessage!(next, new MessageEvent('message', { data: 'late' }));
		expect(onMessage).toHaveBeenCalledOnce();
		expect(onError).not.toHaveBeenCalled();
		expect(onDisconnected).not.toHaveBeenCalled();
		expect(stream.send('late')).toBe(false);
	} finally {
		await scope.close();
	}
});

it('cancels a late response body after the owning scope is disposed', async () => {
	const scope = new PluginScope(() => {});
	const entered = Promise.withResolvers<void>();
	const pending = Promise.withResolvers<Response>();
	const cancel = vi.fn();
	vi.stubGlobal(
		'fetch',
		vi.fn(() => {
			entered.resolve();
			return pending.promise;
		}),
	);
	const client = new HttpClientService().bind('@test/fixture', scope);
	const read = client.request('fixture');
	const rejected = expect(read).rejects.toMatchObject({ code: 'PLUGIN_CONTEXT_EXPIRED' });
	await entered.promise;
	await scope.close();
	pending.resolve(new Response(new ReadableStream({ cancel })));
	await rejected;
	expect(cancel).toHaveBeenCalledOnce();
});

it('does not start a task when its view close guard cannot be registered', async () => {
	const scope = new PluginScope(() => {});
	const view = {
		signal: new AbortController().signal,

		onBeforeClose() {
			throw new Error('fixture close guard failure');
		},
	} as unknown as PluginViewApi;
	const work = vi.fn(() => 42);
	try {
		await expect(new TaskService({ report() {} }).bind('@test/fixture', scope).run(work, { view })).rejects.toThrow(
			'fixture close guard failure',
		);
		expect(work).not.toHaveBeenCalled();
	} finally {
		await scope.close();
	}
});
