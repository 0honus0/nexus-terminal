import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';
import type { Readable } from 'node:stream';
import type { z } from 'zod';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';
import type { HttpHostRegistration, HttpRouter } from './http-router.js';

export { HttpFailure } from './http-failure.js';

interface HttpRouteBase<Input extends z.ZodObject> {
	readonly method: 'get' | 'post' | 'put' | 'patch' | 'delete';
	/** 相对于登记方的路径，可使用 Express 命名参数；流路由允许末尾的命名通配段。 */
	readonly path: string;
	readonly input: Input;
	/** 缩短路由的生命周期，例如使用 ctx.use() 提供的依赖作用域。 */
	readonly lifetime?: PluginScopeApi;
}

export interface HttpRoute<
	Input extends z.ZodObject,
	Output extends z.ZodObject,
	Context extends unknown[] = [],
> extends HttpRouteBase<Input> {
	readonly output: Output;
	/** 成功响应状态，省略时为 200。 */
	readonly status?: number;
	/** 请求断开或路由撤销时取消，处理函数应等待已发起的 I/O 完成。 */
	readonly handler: (
		input: z.output<NoInfer<Input>>,
		signal: AbortSignal,
		...context: Context
	) => z.input<NoInfer<Output>> | Promise<z.input<NoInfer<Output>>>;
}

/** 内部容纳不同 Schema 的路由；各自的 handler 由公开登记签名校验。 */
export type HttpJsonRouteRegistration<Context extends unknown[] = []> = Omit<
	HttpRoute<z.ZodObject, z.ZodObject, Context>,
	'handler'
> & {
	readonly handler: (
		input: never,
		signal: AbortSignal,
		...context: Context
	) => z.input<z.ZodObject> | Promise<z.input<z.ZodObject>>;
};

export interface HttpStreamResponse {
	readonly status?: number;
	readonly headers?: Readonly<
		Pick<
			OutgoingHttpHeaders,
			| 'content-type'
			| 'cache-control'
			| 'content-security-policy'
			| 'content-length'
			| 'content-disposition'
			| 'content-range'
			| 'accept-ranges'
			| 'etag'
			| 'last-modified'
		>
	>;
	readonly body?: Readable;
}

export interface HttpStreamContext {
	readonly method: string;
	readonly headers: Readonly<
		Pick<
			IncomingHttpHeaders,
			'content-length' | 'content-type' | 'range' | 'if-match' | 'if-none-match' | 'if-range'
		>
	>;
	readonly signal: AbortSignal;
	readonly body: Readable | undefined;

	/** 等待传输完成；HEAD 仅发送响应头。 */
	reply(response: HttpStreamResponse): Promise<void>;
}

export interface HttpStreamRoute<Input extends z.ZodObject> extends Omit<HttpRouteBase<Input>, 'method'> {
	readonly method: HttpRouteBase<Input>['method'] | 'head';
	readonly output?: never;
	/** 路径及查询交给 input 检查，二进制内容从 context.body 读取。 */
	readonly body?: 'binary';
	readonly handler: (input: z.output<NoInfer<Input>>, context: HttpStreamContext) => Promise<void>;
}

export type HttpStreamRegistration = Omit<HttpStreamRoute<z.ZodObject>, 'handler'> & {
	readonly handler: (input: never, context: HttpStreamContext) => Promise<void>;
};

export type HttpRouteRegistration<Context extends unknown[] = []> =
	HttpJsonRouteRegistration<Context> | HttpStreamRegistration;

type HttpRouteDefinition<Route extends HttpRouteRegistration> = Route extends HttpJsonRouteRegistration
	? HttpRoute<Route['input'], Route['output']>
	: HttpStreamRoute<Route['input']>;

export type HttpRouteBatch<Routes extends readonly HttpRouteRegistration[]> = Routes & {
	readonly [Index in keyof Routes]: HttpRouteDefinition<Routes[Index]>;
};

export interface PluginHttpApi {
	/** 整批校验成功后登记到当前插件的路径，停用时自动撤销。 */
	register<const Routes extends readonly HttpRouteRegistration[]>(routes: HttpRouteBatch<Routes>): void;
}

/** 路由归属和默认会话准入由绑定确定。 */
export class PluginHttp implements PluginHttpApi {
	readonly #router: Pick<HttpRouter, 'register'>;
	readonly #ownerId: string;
	readonly #scope: PluginScopeApi;

	constructor(router: Pick<HttpRouter, 'register'>, ownerId: string, scope: PluginScopeApi) {
		this.#router = router;
		this.#ownerId = ownerId;
		this.#scope = scope;
	}

	register<const Routes extends readonly HttpRouteRegistration[]>(routes: HttpRouteBatch<Routes>): void {
		this.#router.register(
			`/api/plugins/${encodeURIComponent(this.#ownerId)}`,
			this.#scope,
			routes.map((route): HttpHostRegistration => {
				if (route.output === undefined) return { ...route, policy: undefined };
				return {
					...route,
					policy: undefined,

					handler: (input: never, signal: AbortSignal) => route.handler(input, signal),
				};
			}),
		);
	}
}
