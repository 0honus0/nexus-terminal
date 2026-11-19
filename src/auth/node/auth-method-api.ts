import type { CookieOptions, Request, RequestHandler } from 'express';
import type { z } from 'zod';
import { HttpFailure, type HttpApi, type HttpAuthenticate, type HttpHostRoute } from '../../http/node/http-api.js';
import type { HttpJsonRouteRegistration, HttpRoute } from '../../http/node/http-plugin-api.js';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';
import type { PluginReadiness } from '../../plugin/plugin-state-types.js';
import { CodedError } from '../../utils/error.js';
import type { AuthMethod } from '../auth-http-types.js';

/** 当前登录请求可用的协议数据与响应能力。 */
export interface AuthMethodContextApi {
	readonly url: URL;
	readonly cookieHeader: string | undefined;

	setCookie(name: string, value: string, options: CookieOptions): void;

	/** 设置 303 跳转，响应仍由宿主在处理函数结束后发送。 */
	redirect(location: string): void;

	/** 插件验证协议及身份绑定成功后，为当前请求建立本体账户会话。 */
	completeLogin(): Promise<void>;
}

export interface AuthMethodRoute<Input extends z.ZodObject, Output extends z.ZodObject> extends Omit<
	HttpRoute<Input, Output, [context: AuthMethodContextApi]>,
	'method' | 'lifetime'
> {
	readonly method: 'get' | 'post';
	/** 允许 GET 接收第三方发起的顶层浏览器导航，例如 OIDC 回调。 */
	readonly callback?: true;
}

export type AuthMethodRouteRegistration = Omit<
	HttpJsonRouteRegistration<[context: AuthMethodContextApi]>,
	'method' | 'lifetime'
> &
	Pick<AuthMethodRoute<z.ZodObject, z.ZodObject>, 'method' | 'callback'>;

export interface AuthMethodRegistrationApi {
	readonly baseURL: string;

	/** 撤回本次登记，等待已进入的请求处理完毕。插件停用时也会自动执行。 */
	dispose(): Promise<void>;
}

export interface AuthMethodApi {
	/** id 在当前插件内唯一。label 是由登录页翻译的文案标识。 */
	register<const Routes extends readonly AuthMethodRouteRegistration[]>(method: {
		readonly id: string;
		readonly label: string;
		readonly routes: Routes & {
			readonly [Index in keyof Routes]: AuthMethodRoute<Routes[Index]['input'], Routes[Index]['output']>;
		};
	}): AuthMethodRegistrationApi;
}

const methodId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u;

interface RegisteredAuthMethod {
	readonly summary: AuthMethod;
	readonly readiness: () => PluginReadiness | undefined;
	readonly signal: AbortSignal;
}

interface AuthMethodServices {
	readonly cookieName: string;
	getHttp(): Pick<HttpApi, 'register'> | undefined;
	completeLogin(request: Request, signal: AbortSignal, assertCurrent: () => void): Promise<void>;
	destroySession(request: Request): Promise<void>;
}

class PluginAuthMethods implements AuthMethodApi {
	readonly register: AuthMethodApi['register'];

	constructor(register: AuthMethodApi['register']) {
		this.register = register;
	}
}

/** 管理登录方式的登记、公开准入和在途请求。账户与会话写入由宿主认证负责。 */
export class AuthMethods {
	readonly #services: AuthMethodServices;
	readonly #methods = new Map<string, RegisteredAuthMethod>();

	constructor(services: AuthMethodServices) {
		this.#services = services;
	}

	list(): readonly AuthMethod[] {
		return [...this.#methods.values()].filter((entry) => this.#readyMethod(entry)).map(({ summary }) => summary);
	}

	clear(): void {
		this.#methods.clear();
	}

	/** 运行时交付真实插件身份及就绪状态，插件只能在自己的命名空间登记。 */
	bind(pluginId: string, scope: PluginScopeApi, readiness: RegisteredAuthMethod['readiness']): AuthMethodApi {
		return new PluginAuthMethods((method) => this.#registerMethod(pluginId, scope, readiness, method));
	}

	#registerMethod(
		pluginId: string,
		scope: PluginScopeApi,
		readiness: RegisteredAuthMethod['readiness'],
		{ id, label, routes }: { id: string; label: string; routes: readonly AuthMethodRouteRegistration[] },
	) {
		scope.signal.throwIfAborted();
		const http = this.#services.getHttp();
		if (!http) throw new CodedError('AUTH_NOT_READY');
		if (
			typeof id !== 'string' ||
			!methodId.test(id) ||
			typeof label !== 'string' ||
			!label.trim() ||
			!routes.length
		)
			throw new CodedError('AUTH_METHOD_INVALID');

		const path = `/auth/plugins/${Buffer.from(pluginId).toString('base64url')}/${id}`;
		if (this.#methods.has(path)) throw new CodedError('AUTH_METHOD_DUPLICATE');
		const baseURL = `/api${path}/`;
		const entry: RegisteredAuthMethod = {
			summary: { pluginId, id, label, baseURL },
			signal: scope.signal,
			readiness,
		};
		const removeRoutes = http.register(
			routes.map((route) => {
				if (!route.path.startsWith('/') || !['get', 'post'].includes(route.method))
					throw new CodedError('AUTH_METHOD_ROUTE_INVALID');
				return this.#methodRoute(path, route, scope, entry);
			}),
		);
		this.#methods.set(path, entry);
		let closing: Promise<void> | undefined;

		const dispose = () => {
			if (closing) return closing;
			this.#methods.delete(path);
			untrack();
			return (closing = removeRoutes());
		};

		const untrack = scope.onDispose(dispose);
		return { baseURL, dispose };
	}

	#methodRoute(
		path: string,
		route: AuthMethodRouteRegistration,
		scope: PluginScopeApi,
		entry: RegisteredAuthMethod,
	): HttpHostRoute<AuthMethodRouteRegistration['input'], AuthMethodRouteRegistration['output']> & {
		policy: { access: 'public' | 'callback'; beforeBody: RequestHandler };
	} {
		const { path: relativePath, callback, ...definition } = route;
		// 读取请求体时也可能遇到就绪状态变化。记住准入时的状态，后续使用同一份。
		const admitted = new WeakMap<Request, PluginReadiness>();
		return {
			...definition,
			path: path + (relativePath === '/' ? '' : relativePath),
			lifetime: scope,
			policy: {
				access: callback === true ? 'callback' : 'public',

				beforeBody: (request, _response, next) => {
					const readiness = this.#readyMethod(entry);
					if (!readiness) throw new HttpFailure(503, 'AUTH_METHOD_UNAVAILABLE');
					admitted.set(request, readiness);
					next();
				},
			},

			handler: (input, signal, { request, response }) =>
				this.#handleMethod(entry, admitted.get(request), route, input as never, signal, request, response),
		};
	}

	#readyMethod(entry: RegisteredAuthMethod): PluginReadiness | undefined {
		const current = entry.readiness();
		if (!entry.signal.aborted && current?.state === 'ready') return current;
	}

	async #handleMethod(
		entry: RegisteredAuthMethod,
		readiness: PluginReadiness | undefined,
		route: AuthMethodRouteRegistration,
		input: never,
		signal: AbortSignal,
		request: Request,
		response: Parameters<HttpAuthenticate>[1],
	) {
		const { cookieName } = this.#services;
		let accepting = true;
		let completion: Promise<void> | undefined;
		let sessionSaved = false;
		let redirect: string | undefined;

		const assertCurrent = () => {
			signal.throwIfAborted();
			// 即使插件重新 ready，旧请求也属于此前的就绪状态。
			if (!readiness || this.#readyMethod(entry) !== readiness)
				throw new HttpFailure(503, 'AUTH_METHOD_UNAVAILABLE');
		};

		assertCurrent();
		try {
			const output = await route.handler(input, signal, {
				url: new URL(`${request.protocol}://${request.get('host')}${request.originalUrl}`),
				cookieHeader: request.headers.cookie,

				setCookie(name, value, options) {
					assertCurrent();
					if (!accepting) throw new CodedError('AUTH_METHOD_REQUEST_FINISHED');
					if (name === cookieName) throw new CodedError('AUTH_SESSION_COOKIE_RESERVED');
					response.cookie(name, value, options);
				},

				redirect(location) {
					assertCurrent();
					if (!accepting) throw new CodedError('AUTH_METHOD_REQUEST_FINISHED');
					redirect = location;
				},

				completeLogin: () => {
					if (!accepting) return Promise.reject(new CodedError('AUTH_METHOD_REQUEST_FINISHED'));
					completion ??= this.#services.completeLogin(request, signal, assertCurrent).then(() => {
						sessionSaved = true;
						assertCurrent();
					});
					// 即使插件忘记 await，宿主仍等待会话写入或回收。
					void completion.catch(() => undefined);
					return completion;
				},
			});
			accepting = false;
			await completion;
			assertCurrent();
			if (redirect !== undefined) response.location(redirect).status(303);
			return output;
		} catch (cause) {
			accepting = false;
			await completion?.catch(() => undefined);
			if (sessionSaved) await this.#services.destroySession(request);
			throw cause;
		}
	}
}
