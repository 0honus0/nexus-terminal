import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import {
	PluginRuntimeListSchema,
	PluginRuntimeStateTopic,
	type PluginRuntimeInfo,
} from '../../../src/plugin/plugin-state-types.js';
import { StateMessageSchema } from '../../../src/state/state-ws-types.js';
import type { AppOptions } from '../../../src/app/node/app.js';
import { assembleAppServices } from '../../../src/app/node/app-services.js';
import { PluginAppService, PluginRuntime, type PluginAppApi } from '../../../src/plugin/plugin-api.node.js';

/** 运行时测试直接使用真实宿主服务，测试可控制插件实例而不扩大 App 的接口。 */
export class PluginTestHost {
	readonly services: ReturnType<typeof assembleAppServices>['services'];
	readonly #app: PluginAppService<PluginAppApi>;
	#runtime: PluginRuntime | undefined;

	constructor(options: AppOptions) {
		const { services, pluginCapabilities } = assembleAppServices(options);
		this.services = services;
		this.#app = new PluginAppService(pluginCapabilities);
	}

	get runtime(): PluginRuntime {
		if (!this.#runtime) throw new Error('PLUGIN_TEST_HOST_NOT_READY');
		return this.#runtime;
	}

	async initialize(): Promise<void> {
		await this.services.initialize();
		this.#runtime ??= new PluginRuntime({ app: this.#app, services: this.services });
	}

	async close(): Promise<void> {
		try {
			await this.#runtime?.close();
		} finally {
			await this.services.close();
		}
	}
}

/** 从与浏览器相同的已认证状态主题读取运行时快照。 */
export async function readPluginRuntime(origin: string, cookie: string): Promise<readonly PluginRuntimeInfo[]> {
	const signal = AbortSignal.timeout(3000);
	const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/state/ws', {
		headers: { cookie },
		handshakeTimeout: 3000,
	});
	try {
		await once(socket, 'open', { signal });
		const pending = once(socket, 'message', { signal });
		socket.send(JSON.stringify({ type: 'subscribe', topic: PluginRuntimeStateTopic }));
		const [data] = await pending;
		const frame = StateMessageSchema.parse(JSON.parse(String(data)));
		assert.equal(frame.type, 'snapshot');
		assert.deepEqual(frame.topic, PluginRuntimeStateTopic);
		return PluginRuntimeListSchema.parse(frame.state);
	} finally {
		socket.terminate();
	}
}
