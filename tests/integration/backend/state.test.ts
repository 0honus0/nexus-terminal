import assert from 'node:assert/strict';
import { on, once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import jsonPatch from 'fast-json-patch';
import { WebSocket } from 'ws';
import { z } from 'zod';
import { PluginTestHost } from './plugin-test-host.js';
import { PluginScope } from '../../../src/plugin/plugin-api.js';
import { PluginRuntimeListSchema, PluginRuntimeStateTopic } from '../../../src/plugin/plugin-state-types.js';
import { StateApi } from '../../../src/state/node/state-api.js';
import { StateMessageSchema, type StateCommand } from '../../../src/state/state-ws-types.js';
import {
	PreferencesSnapshotSchema,
	type PreferencesSnapshot,
} from '../../fixtures/plugins/test/src/preferences-types.js';

async function nextFrame(messages: ReturnType<typeof on>) {
	const next = await messages.next();
	assert.equal(next.done, false);
	assert.equal(next.value[1], false);
	return StateMessageSchema.parse(JSON.parse(next.value[0].toString()));
}

async function connect(url: string, cookie: string) {
	const socket = new WebSocket(url, { headers: { cookie }, handshakeTimeout: 2000 });
	const messages = on(socket, 'message', { close: ['close'] });
	await once(socket, 'open');
	return { socket, messages };
}

function send(socket: WebSocket, command: StateCommand): void {
	socket.send(JSON.stringify(command));
}

test('状态 WS 按主题同步插件、设置及插件自有状态', { timeout: 10000 }, async () => {
	const dataDirectory = await mkdtemp(join(tmpdir(), 'nexus-state-ws-'));
	const host = new PluginTestHost({ dataDirectory, logLevel: 'fatal' });
	const plugin = fileURLToPath(new URL('../../fixtures/plugins/test/', import.meta.url));
	const pluginTopic = { name: 'items', pluginId: '@nexus-terminal/test' };
	const preferencesTopic = { name: 'preferences', pluginId: pluginTopic.pluginId };
	try {
		await host.initialize();
		const origin = host.services.get('http').origin;
		const url = origin.replace('http:', 'ws:') + '/api/state/ws';
		const initialized = await fetch(`${origin}/api/auth/initialize`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ username: 'test', password: 'test-password' }),
		});
		assert.equal(initialized.status, 201);
		await initialized.arrayBuffer();
		const cookie = initialized.headers.get('set-cookie')?.split(';', 1)[0];
		assert.ok(cookie);
		const headers = { 'content-type': 'application/json', cookie };

		async function submitPreferences(snapshot: PreferencesSnapshot): Promise<PreferencesSnapshot> {
			const response = await fetch(
				`${origin}/api/plugins/${encodeURIComponent(pluginTopic.pluginId)}/preferences`,
				{
					method: 'POST',
					headers,
					body: JSON.stringify(snapshot),
				},
			);
			assert.equal(response.status, 200);
			return PreferencesSnapshotSchema.parse(await response.json());
		}

		const { socket, messages } = await connect(url, cookie);
		send(socket, { type: 'subscribe', topic: PluginRuntimeStateTopic });
		const firstRuntime = await nextFrame(messages);
		assert.equal(firstRuntime.type, 'snapshot');
		assert.deepEqual(firstRuntime.topic, PluginRuntimeStateTopic);
		assert.deepEqual(firstRuntime.state, []);
		send(socket, { type: 'subscribe', topic: preferencesTopic });
		assert.equal((await nextFrame(messages)).type, 'unavailable');

		send(socket, { type: 'subscribe', topic: pluginTopic });
		assert.deepEqual(await nextFrame(messages), {
			type: 'unavailable',
			topic: pluginTopic,
			code: 'STATE_TOPIC_UNAVAILABLE',
		});

		let plugins = PluginRuntimeListSchema.parse(firstRuntime.state);
		let runtimeRevision = firstRuntime.revision;
		const runtimeInstanceId = firstRuntime.instanceId;

		const pluginRuntimeState = () => plugins.find(({ pluginId }) => pluginId === pluginTopic.pluginId)?.runtime;

		function applyRuntimeFrame(message: Awaited<ReturnType<typeof nextFrame>>) {
			assert.equal(message.type, 'patch');
			assert.deepEqual(message.topic, PluginRuntimeStateTopic);
			assert.equal(message.instanceId, runtimeInstanceId);
			assert.equal(message.baseRevision, runtimeRevision);
			assert.equal(message.revision, runtimeRevision + 1);
			plugins = PluginRuntimeListSchema.parse(
				jsonPatch.applyPatch(plugins, message.changes, true, false).newDocument,
			);
			runtimeRevision = message.revision;
		}

		await host.runtime.start([plugin]);
		while (pluginRuntimeState() !== 'running') applyRuntimeFrame(await nextFrame(messages));

		// 测试插件只声明了 items，宿主为它补上插件身份。
		send(socket, { type: 'subscribe', topic: { name: pluginTopic.name } });
		assert.equal((await nextFrame(messages)).type, 'unavailable');
		send(socket, { type: 'subscribe', topic: pluginTopic });
		const firstPlugin = await nextFrame(messages);
		assert.equal(firstPlugin.type, 'snapshot');
		assert.deepEqual(firstPlugin.topic, pluginTopic);
		assert.deepEqual(firstPlugin.state, { count: 1 });
		assert.equal(firstPlugin.revision, 1);

		send(socket, { type: 'subscribe', topic: { name: preferencesTopic.name } });
		assert.equal((await nextFrame(messages)).type, 'unavailable');
		send(socket, { type: 'subscribe', topic: preferencesTopic });
		const firstSettings = await nextFrame(messages);
		assert.equal(firstSettings.type, 'snapshot');
		assert.deepEqual(firstSettings.topic, preferencesTopic);
		assert.notEqual(firstSettings.instanceId, firstRuntime.instanceId);
		assert.equal(PreferencesSnapshotSchema.parse(firstSettings.state).revision, 0);

		const current = PreferencesSnapshotSchema.parse({
			revision: 2,
			preferences: { theme: 'dark', locale: 'zh-CN' },
		});
		assert.deepEqual(await submitPreferences(current), current);
		const settingsPatch = await nextFrame(messages);
		assert.equal(settingsPatch.type, 'patch');
		assert.deepEqual(settingsPatch.topic, preferencesTopic);
		assert.equal(settingsPatch.instanceId, firstSettings.instanceId);
		assert.equal(settingsPatch.baseRevision, firstSettings.revision);
		assert.equal(settingsPatch.revision, firstSettings.revision + 1);
		assert.deepEqual(
			jsonPatch.applyPatch(firstSettings.state, settingsPatch.changes, true, false).newDocument,
			current,
		);

		const stale: PreferencesSnapshot = {
			...current,
			revision: 1,
			preferences: { ...current.preferences, theme: 'light' },
		};
		assert.deepEqual(await submitPreferences(stale), current);
		send(socket, { type: 'unsubscribe', topic: preferencesTopic });
		// 在同一连接上用 resync 确认前一条 unsubscribe 已处理。
		send(socket, { type: 'resync', topic: preferencesTopic });
		const resynced = await nextFrame(messages);
		assert.equal(resynced.type, 'snapshot');
		assert.equal(resynced.revision, settingsPatch.revision);
		assert.deepEqual(resynced.state, current);
		await submitPreferences({ ...current, revision: 3 });
		send(socket, { type: 'resync', topic: preferencesTopic });
		const afterUnsubscribe = await nextFrame(messages);
		assert.equal(afterUnsubscribe.type, 'snapshot');
		assert.equal(afterUnsubscribe.revision, resynced.revision + 1);
		assert.deepEqual(afterUnsubscribe.state, { ...current, revision: 3 });
		send(socket, { type: 'subscribe', topic: preferencesTopic });
		assert.deepEqual(await nextFrame(messages), afterUnsubscribe);

		const runtime = host.runtime;
		await runtime.stop(pluginTopic.pluginId);
		const revoked = new Set<string>();
		while (pluginRuntimeState() !== 'stopped' || revoked.size !== 2) {
			const message = await nextFrame(messages);
			if (message.type === 'unavailable') {
				assert.equal(message.topic.pluginId, pluginTopic.pluginId);
				assert.ok(message.topic.name === pluginTopic.name || message.topic.name === preferencesTopic.name);
				revoked.add(message.topic.name);
			} else {
				applyRuntimeFrame(message);
			}
		}

		const closed = once(socket, 'close');
		socket.send(JSON.stringify({ type: 'write' }));
		assert.equal((await closed)[0], 1008);
		const reconnected = await connect(url, cookie);
		send(reconnected.socket, { type: 'subscribe', topic: PluginRuntimeStateTopic });
		const afterReconnect = await nextFrame(reconnected.messages);
		assert.equal(afterReconnect.type, 'snapshot');
		assert.equal(afterReconnect.instanceId, firstRuntime.instanceId);
		assert.equal(afterReconnect.revision, runtimeRevision);
		assert.deepEqual(afterReconnect.state, plugins);

		await runtime.reload(pluginTopic.pluginId);
		while (pluginRuntimeState() !== 'running') applyRuntimeFrame(await nextFrame(reconnected.messages));
		send(reconnected.socket, { type: 'subscribe', topic: pluginTopic });
		const reloaded = await nextFrame(reconnected.messages);
		assert.equal(reloaded.type, 'snapshot');
		assert.deepEqual(reloaded.topic, pluginTopic);
		assert.notEqual(reloaded.instanceId, firstPlugin.instanceId);
		assert.deepEqual(reloaded.state, firstPlugin.state);

		await runtime.close();
		// 运行时先交付插件终态，再撤销自己的主题。此时共享 WS 仍能响应命令。
		for (;;) {
			const message = await nextFrame(reconnected.messages);
			if (message.type === 'patch') {
				applyRuntimeFrame(message);
				continue;
			}
			assert.equal(message.type, 'unavailable');
			if (message.topic.name === PluginRuntimeStateTopic.name) {
				assert.deepEqual(message.topic, PluginRuntimeStateTopic);
				break;
			}
			assert.deepEqual(message.topic, pluginTopic);
		}
		assert.equal(pluginRuntimeState(), 'stopped');
		send(reconnected.socket, { type: 'resync', topic: PluginRuntimeStateTopic });
		assert.deepEqual(await nextFrame(reconnected.messages), {
			type: 'unavailable',
			topic: PluginRuntimeStateTopic,
			code: 'STATE_TOPIC_UNAVAILABLE',
		});
	} finally {
		try {
			await host.close();
		} finally {
			await rm(dataDirectory, { recursive: true, force: true });
		}
	}
});

test('状态发布跟随插件及依赖作用域，取消会释放主题名并拒绝旧 publisher', async (t) => {
	const state = new StateApi({ services: { ws: { register: () => async () => undefined } } });
	t.after(() => state.close());

	const owner = new PluginScope(() => {});
	const lifetime = new PluginScope(() => {});
	const plugin = state.bind('@test/provider', owner);
	const options = { name: 'health', schema: z.boolean(), initial: true };
	const publisher = plugin.register({ ...options, lifetime });

	assert.throws(() => plugin.register(options), { code: 'STATE_TOPIC_DUPLICATE' });
	lifetime.abort();
	assert.throws(() => publisher.publish(false), { code: 'PLUGIN_CONTEXT_EXPIRED' });
	assert.throws(() => plugin.register({ ...options, lifetime }), { code: 'PLUGIN_CONTEXT_EXPIRED' });

	const resumed = plugin.register(options);
	resumed.publish(false);
	owner.abort();
	assert.throws(() => resumed.publish(true), { code: 'PLUGIN_CONTEXT_EXPIRED' });

	const next = state.bind('@test/provider', new PluginScope(() => {}));
	assert.doesNotThrow(() => next.register(options));
});
