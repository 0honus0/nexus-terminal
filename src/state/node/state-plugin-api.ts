import type { z } from 'zod';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';

export interface StateRegistration<Schema extends z.ZodType> {
	readonly name: string;
	readonly schema: Schema;
	readonly initial: z.input<NoInfer<Schema>>;
	readonly lifetime?: PluginScopeApi;
}

export interface StatePublisherApi<Value> {
	/** 发布该主题的当前值，宿主计算传输增量。 */
	publish(value: Value): void;
}

export interface PluginStateApi {
	/** 宿主绑定插件 ID，停用或依赖作用域关闭时自动撤销主题。 */
	register<Schema extends z.ZodType>(options: StateRegistration<Schema>): StatePublisherApi<z.input<Schema>>;
}

/** 插件登记主题，宿主绑定其身份并同步快照。 */
export class PluginState implements PluginStateApi {
	readonly #register: PluginStateApi['register'];

	constructor(register: PluginStateApi['register']) {
		this.#register = register;
	}

	register<Schema extends z.ZodType>(options: StateRegistration<Schema>): StatePublisherApi<z.input<Schema>> {
		return this.#register(options);
	}
}
