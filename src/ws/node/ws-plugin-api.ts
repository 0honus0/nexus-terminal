import type { WebSocket } from 'ws';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';

export interface WsConnectionContext {
	readonly query: URLSearchParams;
	/** 连接关闭、会话失效或插件停用时取消。 */
	readonly signal: AbortSignal;
}

export interface WsRoute {
	readonly path: string;
	readonly maxPayload?: number;
	readonly lifetime?: PluginScopeApi;

	/** 文本和二进制消息由业务协议处理，宿主负责握手和连接生命周期。 */
	handler(socket: WebSocket, context: WsConnectionContext): void | Promise<void>;
}

export interface PluginWsApi {
	/** 在当前插件命名空间登记会话保护的路径。插件停用时自动撤销。 */
	register(route: WsRoute): void;
}

/** 登记入口已绑定当前插件路径和会话准入。 */
export class PluginWs implements PluginWsApi {
	readonly #register: PluginWsApi['register'];

	constructor(register: PluginWsApi['register']) {
		this.#register = register;
	}

	register(route: WsRoute): void {
		this.#register(route);
	}
}
