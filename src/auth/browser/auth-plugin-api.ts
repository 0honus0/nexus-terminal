import type { Component, MaybeRefOrGetter } from 'vue';

export interface AuthLoginActionApi {
	/** 与该插件的后端登录方式匹配的同源地址。 */
	readonly baseURL: string;
	readonly signal: AbortSignal;

	/** 通知宿主重新读取服务端会话。整页跳转在页面返回时由宿主启动流程确认。 */
	onComplete(): Promise<void>;
}

export interface AuthLoginContribution {
	/** 与同一插件在后端登记的登录方式 ID 相同。 */
	readonly id: string;
	readonly label: MaybeRefOrGetter<string>;
	readonly icon?: Component;
	start(action: AuthLoginActionApi): void | Promise<void>;
}
