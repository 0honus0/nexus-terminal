import { addAbortListener } from 'node:events';
import { EndpointsFactory, InputValidationError, OutputValidationError, ResultHandler } from 'express-zod-api';
import { Router, json, type ErrorRequestHandler, type Request, type RequestHandler, type Response } from 'express';
import type { z } from 'zod';
import type { LogApi } from '../../log/node/log-api.js';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';
import { CodedError } from '../../utils/error.js';
import { HttpProblemSchema, type HttpProblem, type HttpProblemCode } from '../http-problem-http-types.js';
import { HttpFailure } from './http-failure.js';
import type {
	HttpJsonRouteRegistration,
	HttpRoute,
	HttpRouteRegistration,
	HttpStreamRoute,
} from './http-plugin-api.js';
import { handleHttpStream } from './http-stream.js';

const problemStatuses = {
	HTTP_INVALID_REQUEST: 400,
	HTTP_ORIGIN_DENIED: 403,
	HTTP_NOT_FOUND: 404,
	HTTP_PAYLOAD_TOO_LARGE: 413,
	HTTP_UNSUPPORTED_MEDIA_TYPE: 415,
	HTTP_INTERNAL_ERROR: 500,
	HTTP_ROUTE_CLOSED: 503,
} satisfies Record<HttpProblemCode, number>;

const jsonBody = json({ limit: '2mb' });

const routePath = /^\/(?:[\w~-]+(?:\.[\w~-]+)*|:[a-zA-Z_][\w]*)(?:\/(?:[\w~-]+(?:\.[\w~-]+)*|:[a-zA-Z_][\w]*))*$/u;

const streamTail = /\/\*[a-zA-Z_]\w*$/u;

interface Route {
	readonly method: HttpStreamRoute<z.ZodObject>['method'];
	readonly path: string;
	readonly handle: RequestHandler;
	close(): Promise<void>;
}

interface PendingRoute extends Route {
	readonly key: string;
	readonly signal: AbortSignal;
	attach(): void;
}

export type HttpAuthenticate = (request: Request, response: Response, signal: AbortSignal) => Promise<boolean>;

export interface HttpServices {
	readonly log: Pick<LogApi, 'report'>;
	readonly auth: { readonly authenticate: HttpAuthenticate };
}

export interface HttpRoutePolicy {
	readonly access?: 'public' | 'session' | 'callback';
	readonly beforeBody?: RequestHandler;
	/** 宿主路由可为当前请求明确开放匿名读取。普通插件的绑定接口不交付此权限。 */
	readonly allowAnonymous?: (request: Request, signal: AbortSignal) => boolean | Promise<boolean>;
}

export interface HttpHostContext {
	readonly request: Request;
	readonly response: Response;
}

export type HttpHostRegistration = HttpRouteRegistration<[context: HttpHostContext]> & {
	readonly policy?: HttpRoutePolicy;
};

export type HttpHostRoute<Input extends z.ZodObject, Output extends z.ZodObject> = HttpRoute<
	Input,
	Output,
	[context: HttpHostContext]
>;

type HttpHandler = (request: Request, response: Response, signal: AbortSignal) => Promise<void>;

async function runMiddleware(middleware: RequestHandler, request: Request, response: Response): Promise<void> {
	let detach = () => {};

	try {
		await new Promise<void>((resolve, reject) => {
			const ended = () => resolve();

			detach = () => {
				response.off('finish', ended);
				response.off('close', ended);
			};
			response.once('finish', ended);
			response.once('close', ended);
			Promise.resolve(
				middleware(request, response, (cause: unknown) => {
					if (cause) reject(cause);
					else resolve();
				}),
			).catch(reject);
		});
	} finally {
		detach();
	}
}

export function sendHttpProblem(response: Response, problem: HttpProblemCode | HttpFailure): void {
	if (response.destroyed || response.writableEnded) return;
	if (response.headersSent) {
		response.destroy();
		return;
	}
	const [status, code] =
		typeof problem === 'string' ? [problemStatuses[problem], problem] : [problem.status, problem.code];
	const body: HttpProblem = { type: 'about:blank', status, code };
	for (const name of ['Content-Length', 'Content-Encoding', 'Content-Disposition', 'ETag'])
		response.removeHeader(name);
	response.status(status).type('application/problem+json').json(body);
}

/** 管理可撤销路由。每次登记更新 Express Router，已经进入的请求继续由旧登记负责。 */
export class HttpRouter {
	#routes = new Map<string, Route>();
	readonly #draining = new Set<Promise<void>>();
	readonly #requestSignals = new WeakMap<Request, AbortSignal>();
	readonly #controller = new AbortController();
	readonly #log: Pick<LogApi, 'report'>;
	readonly #auth: HttpServices['auth'];
	readonly #endpoints;
	readonly #logger;
	#router = Router({ caseSensitive: true, strict: true });

	constructor({ log, auth }: HttpServices) {
		this.#log = log;
		this.#auth = auth;

		const reportFailure = () => this.#reportFailure();

		this.#logger = {
			debug() {},

			info() {},

			warn: reportFailure,
			error: reportFailure,
		};

		const results = new ResultHandler({
			positive: (output) => output,

			negative: {
				schema: HttpProblemSchema,
				mimeType: 'application/problem+json',
				statusCode: Object.values(problemStatuses) as [number, ...number[]],
			},

			handler: ({ request, response, error, output }) => {
				if (response.destroyed || response.writableEnded) return;
				if (this.#requestSignals.get(request)?.aborted) {
					sendHttpProblem(response, 'HTTP_ROUTE_CLOSED');
					return;
				}
				if (error instanceof InputValidationError) {
					sendHttpProblem(response, 'HTTP_INVALID_REQUEST');
					return;
				}
				if (error) {
					if (error instanceof OutputValidationError) this.#reportFailure('HTTP_INVALID_RESPONSE');
					this.#handleFailure(error, response, !(error instanceof OutputValidationError));
					return;
				}
				try {
					if (response.statusCode === 204) response.end();
					else response.json(output);
				} catch {
					this.#reportFailure();
					sendHttpProblem(response, 'HTTP_INTERNAL_ERROR');
				}
			},
		});
		this.#endpoints = new EndpointsFactory(results).addMiddleware({
			handler: async ({ request, response }) => {
				const signal = this.#requestSignals.get(request);
				if (!signal) throw new CodedError('HTTP_REQUEST_SCOPE_MISSING');
				return { signal, request, response };
			},
		});
	}

	readonly dispatch: RequestHandler = (request, response, next) => this.#router(request, response, next);

	readonly handleError: ErrorRequestHandler = (cause: unknown, _request, response, _next) => {
		this.#handleFailure(cause, response);
	};

	#handleFailure(cause: unknown, response: Response, report = true): void {
		const type = (cause as { type?: unknown } | null)?.type;
		if (cause instanceof HttpFailure) {
			sendHttpProblem(response, cause);
		} else if (type === 'entity.parse.failed' || type === 'request.size.invalid' || cause instanceof URIError) {
			sendHttpProblem(response, 'HTTP_INVALID_REQUEST');
		} else if (type === 'entity.too.large') {
			sendHttpProblem(response, 'HTTP_PAYLOAD_TOO_LARGE');
		} else if (type === 'encoding.unsupported' || type === 'charset.unsupported') {
			sendHttpProblem(response, 'HTTP_UNSUPPORTED_MEDIA_TYPE');
		} else if (type !== 'request.aborted') {
			if (report) this.#reportFailure();
			sendHttpProblem(response, 'HTTP_INTERNAL_ERROR');
		}
	}

	register(
		prefix: string,
		owner: PluginScopeApi | undefined,
		routes: readonly HttpHostRegistration[],
	): () => Promise<void> {
		const batch = routes.map((route) => {
			const handle: HttpHandler =
				route.output === undefined
					? (request, response, signal) => handleHttpStream(route, request, response, signal)
					: this.#jsonHandler(route);
			return this.#prepare(prefix, owner, route, route.policy ?? {}, handle);
		});
		this.#publish(batch);

		return async () => {
			await Promise.all(batch.map((route) => route.close()));
		};
	}

	#jsonHandler({
		method,
		input,
		output,
		status,
		handler,
	}: HttpJsonRouteRegistration<[HttpHostContext]>): HttpHandler {
		if (status !== undefined && (!Number.isInteger(status) || status < 200 || status > 299))
			throw new CodedError('HTTP_ROUTE_STATUS_INVALID');

		const endpoint = this.#endpoints.build({
			method,
			input,
			output,

			handler: async ({ ctx, input }) => {
				// Schema 与处理函数在 register() 中已按同一条路由绑定。
				ctx.signal.throwIfAborted();
				// 声明的是成功默认状态。协议处理器仍可决定是否跳转。
				if (status !== undefined) ctx.response.status(status);
				return (await handler(input as never, ctx.signal, {
					request: ctx.request,
					response: ctx.response,
				})) as z.input<typeof output>;
			},
		});
		return async (request, response, signal) => {
			if (!request.complete) {
				using cancelBody = addAbortListener(signal, () => request.destroy());
				await runMiddleware(jsonBody, request, response);
			} else {
				await runMiddleware(jsonBody, request, response);
			}
			signal.throwIfAborted();
			if (!response.writableEnded) {
				await endpoint.execute({ request, response, logger: this.#logger, config: { cors: false } });
			}
		};
	}

	#prepare(
		prefix: string,
		owner: PluginScopeApi | undefined,
		{ method, path, lifetime, output }: HttpHostRegistration,
		policy: HttpRoutePolicy,
		handler: HttpHandler,
	): PendingRoute {
		const controller = new AbortController();
		const signals = [this.#controller.signal, controller.signal];
		if (owner) signals.push(owner.signal);
		if (lifetime) signals.push(lifetime.signal);
		const signal = AbortSignal.any(signals);
		signal.throwIfAborted();
		const routePrefix = output === undefined ? path.replace(streamTail, '') : path;
		if (path !== '/' && !routePath.test(routePrefix)) throw new CodedError('HTTP_ROUTE_PATH_INVALID');
		if (policy.access === 'callback' && method !== 'get') throw new CodedError('HTTP_CALLBACK_METHOD_INVALID');
		const fullPath = prefix + (path === '/' ? '' : path);
		const key = `${method} ${fullPath.replace(/([:*])\w+/gu, '$1')}`;
		const requests = new Set<Promise<unknown>>();
		const unregister: (() => void)[] = [];
		let closing: Promise<void> | undefined;

		const route: PendingRoute = {
			key,
			method,
			path: fullPath,
			signal,

			attach: () => {
				signal.throwIfAborted();
				// 取消时同步撤销路由，作用域清理会等待已进入的请求结束。
				signal.addEventListener('abort', () => void route.close(), { once: true });
				if (owner) unregister.push(owner.onDispose(route.close));
				if (lifetime) unregister.push(lifetime.onDispose(route.close));
			},

			handle: async (request, response) => {
				if (signal.aborted) {
					sendHttpProblem(response, 'HTTP_ROUTE_CLOSED');
					return;
				}
				const operation = this.#execute(request, response, signal, policy, handler);
				requests.add(operation);
				try {
					await operation;
				} finally {
					requests.delete(operation);
				}
			},

			close: () => {
				if (closing) return closing;
				const drained = Promise.allSettled(requests).then(() => {
					this.#draining.delete(drained);
					for (const remove of unregister) remove();
				});
				closing = drained;
				this.#draining.add(drained);
				if (this.#routes.get(key) === route) {
					this.#routes.delete(key);
					if (!this.#controller.signal.aborted) this.#router = this.#buildRouter(this.#routes);
				}
				controller.abort(new CodedError('HTTP_ROUTE_CLOSED'));
				return drained;
			},
		};
		return route;
	}

	#publish(routes: readonly PendingRoute[]): void {
		if (routes.length === 0) return;
		try {
			for (const route of routes) route.attach();
			// 作用域登记可能同步触发取消，发布前以当前路由表为准。
			const next = new Map(this.#routes);
			for (const route of routes) {
				route.signal.throwIfAborted();
				if (next.has(route.key)) throw new CodedError('HTTP_ROUTE_DUPLICATE');
				next.set(route.key, route);
			}
			const router = this.#buildRouter(next);
			this.#routes = next;
			this.#router = router;
		} catch (cause) {
			for (const route of routes) void route.close();
			throw cause;
		}
	}

	async close(): Promise<void> {
		this.#router = Router();
		this.#controller.abort(new CodedError('HTTP_SERVER_CLOSED'));
		await Promise.all(this.#draining);
	}

	#buildRouter(routes: ReadonlyMap<string, Route>): Router {
		const router = Router({ caseSensitive: true, strict: true });
		// Express 的 GET 会隐式响应 HEAD，显式 HEAD 必须优先匹配。
		for (const route of routes.values()) if (route.method === 'head') router.head(route.path, route.handle);
		for (const { method, path, handle } of routes.values()) if (method !== 'head') router[method](path, handle);
		return router;
	}

	async #execute(
		request: Request,
		response: Response,
		route: AbortSignal,
		{ access = 'session', beforeBody, allowAnonymous }: HttpRoutePolicy,
		handler: HttpHandler,
	): Promise<void> {
		const client = new AbortController();
		const signal = AbortSignal.any([route, client.signal]);

		const disconnect = () => {
			if (!response.writableFinished) client.abort(new CodedError('HTTP_CLIENT_DISCONNECTED'));
		};

		const requestClosed = () => {
			if (!request.complete) disconnect();
		};

		request.once('close', requestClosed);
		request.once('error', disconnect);
		response.once('close', disconnect);
		if (response.destroyed || (request.destroyed && !request.complete)) disconnect();
		this.#requestSignals.set(request, signal);
		try {
			signal.throwIfAborted();
			const origin = request.get('origin');
			const site = request.get('sec-fetch-site');
			const crossSite =
				site === 'cross-site' ||
				(site === 'same-site' && request.method !== 'GET' && request.method !== 'HEAD');
			const callback =
				access === 'callback' && request.method === 'GET' && request.get('sec-fetch-mode') === 'navigate';
			if (
				!callback &&
				(crossSite || (origin !== undefined && origin !== `${request.protocol}://${request.get('host')}`))
			) {
				sendHttpProblem(response, 'HTTP_ORIGIN_DENIED');
				return;
			}
			const authenticated = await this.#auth.authenticate(request, response, signal);
			signal.throwIfAborted();
			if (access === 'session' && !authenticated && !(await allowAnonymous?.(request, signal))) {
				signal.throwIfAborted();
				sendHttpProblem(response, new HttpFailure(401, 'AUTH_REQUIRED'));
				return;
			}
			signal.throwIfAborted();
			if (beforeBody) await runMiddleware(beforeBody, request, response);
			signal.throwIfAborted();
			if (!response.writableEnded && !response.destroyed) await handler(request, response, signal);
		} catch (cause) {
			if (signal.aborted) sendHttpProblem(response, 'HTTP_ROUTE_CLOSED');
			else this.#handleFailure(cause, response);
		} finally {
			this.#requestSignals.delete(request);
			request.off('close', requestClosed);
			request.off('error', disconnect);
			response.off('close', disconnect);
		}
	}

	#reportFailure(code = 'HTTP_INTERNAL_ERROR'): void {
		// 解析错误和插件异常可能含有请求数据，仅上报稳定标识。
		this.#log.report({ source: 'http', level: 'error', code });
	}
}
