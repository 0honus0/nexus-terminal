import type { PluginScopeApi } from './plugin-api.js';

/** 对照 ctx.app 的键声明宿主绑定入口。每个入口返回该插件可用的模块接口。 */
export type PluginCapabilities<Api extends object> = {
	readonly [K in keyof Api]: {
		bind(ownerId: string, scope: PluginScopeApi): Api[K];
	};
};

/** 将宿主显式开放的服务绑定到同一个插件实例作用域。 */
export class PluginAppService<Api extends object> {
	readonly #capabilities: PluginCapabilities<Api>;

	constructor(capabilities: PluginCapabilities<Api>) {
		this.#capabilities = { ...capabilities };
	}

	/** 每个运行实例独立绑定；同一 pluginId 重载后继续使用原有数据。 */
	bind(ownerId: string, scope: PluginScopeApi): Api {
		scope.signal.throwIfAborted();
		// 模块把需要等待的清理登记到这个作用域，运行时负责收尾。
		const entries = Object.entries<PluginCapabilities<Api>[keyof Api]>(this.#capabilities).map(
			([name, capability]) => {
				const api = capability.bind(ownerId, scope);
				scope.signal.throwIfAborted();
				return [name, api] as const;
			},
		);
		// 能力表已逐键校验。Object.fromEntries 无法保留每个键与返回值的关联。
		return Object.fromEntries(entries) as Api;
	}
}
