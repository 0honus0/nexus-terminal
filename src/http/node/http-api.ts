import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import express from 'express';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';
import { CodedError } from '../../utils/error.js';
import {
	PluginHttp,
	type HttpJsonRouteRegistration,
	type HttpStreamRoute,
	type PluginHttpApi,
} from './http-plugin-api.js';
import {
	HttpRouter,
	sendHttpProblem,
	type HttpHostContext,
	type HttpHostRegistration,
	type HttpHostRoute,
	type HttpRoutePolicy,
	type HttpServices,
} from './http-router.js';

export { HttpFailure } from './http-failure.js';

export type { HttpAuthenticate, HttpHostRoute } from './http-router.js';

const host = '127.0.0.1';

type HttpHostRouteDefinition<Route extends HttpHostRegistration> = (Route extends HttpJsonRouteRegistration<
	[HttpHostContext]
>
	? HttpHostRoute<Route['input'], Route['output']>
	: HttpStreamRoute<Route['input']>) & { readonly policy?: HttpRoutePolicy };

type HttpHostBatch<Routes extends readonly HttpHostRegistration[]> = Routes & {
	readonly [Index in keyof Routes]: HttpHostRouteDefinition<Routes[Index]>;
};

interface HttpOptions {
	readonly port: number;
	readonly trustLoopbackProxy?: boolean;
	readonly services: HttpServices;
}

export type HttpUpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

/** AppServices 持有唯一监听器，插件只拿到按身份绑定的路由登记能力。 */
export class HttpApi {
	readonly #server: Server;
	readonly #router: HttpRouter;
	readonly #port: number;
	readonly #log: HttpServices['log'];
	#starting: Promise<void> | undefined;
	#closing: Promise<void> | undefined;
	#detachUpgrade: (() => void) | undefined;

	constructor({ port, trustLoopbackProxy, services }: HttpOptions) {
		this.#port = port;
		this.#log = services.log;
		this.#router = new HttpRouter(services);
		const app = express().disable('x-powered-by').disable('etag');
		if (trustLoopbackProxy) app.set('trust proxy', (ip: string, hop: number) => hop === 0 && ip === host);
		app.use((request, response, next) => {
			response.set('Cache-Control', 'no-store');
			// 先验证监听的 Host，来源校验根据匹配到的路由执行。
			if (!this.#acceptHost(request.get('host'))) {
				sendHttpProblem(response, 'HTTP_ORIGIN_DENIED');
				return;
			}
			next();
		});
		app.use(this.#router.dispatch, (_request, response) => sendHttpProblem(response, 'HTTP_NOT_FOUND'));
		app.use(this.#router.handleError);
		this.#server = createServer(app);
	}

	get origin(): string {
		const address = this.#server.address();
		if (!address || typeof address === 'string') throw new CodedError('HTTP_SERVER_NOT_LISTENING');
		return `http://${host}:${address.port}`;
	}

	initialize(signal: AbortSignal): Promise<void> {
		if (this.#closing) throw new CodedError('HTTP_SERVER_CLOSED');
		return (this.#starting ??= this.#listen(signal));
	}

	/** 本体路由位于 /api 下。plugins 路径由宿主按插件身份分配。 */
	register<const Routes extends readonly HttpHostRegistration[]>(routes: HttpHostBatch<Routes>): () => Promise<void> {
		for (const entry of routes) this.#assertHostPath(entry.path);
		return this.#router.register('/api', undefined, routes);
	}

	/** 只交付一次 Upgrade 登记能力，HTTP 持续管理同一个监听端口。 */
	attachUpgrade(handler: HttpUpgradeHandler): () => void {
		if (this.#closing) throw new CodedError('HTTP_SERVER_CLOSED');
		if (this.#detachUpgrade) throw new CodedError('HTTP_UPGRADE_ALREADY_ATTACHED');

		const listener: HttpUpgradeHandler = (request, socket, head) => {
			const disconnect = () => socket.destroy();

			socket.on('error', disconnect);
			socket.once('close', () => socket.off('error', disconnect));
			const { host: authority, origin } = request.headers;
			if (
				!this.#acceptHost(authority) ||
				request.headers['sec-fetch-site'] === 'cross-site' ||
				(origin !== undefined && origin !== `http://${authority}`)
			) {
				socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
				return;
			}
			handler(request, socket, head);
		};

		const detach = () => {
			this.#server.off('upgrade', listener);
			if (this.#detachUpgrade === detach) this.#detachUpgrade = undefined;
		};

		this.#server.on('upgrade', listener);
		return (this.#detachUpgrade = detach);
	}

	bind(ownerId: string, scope: PluginScopeApi): PluginHttpApi {
		scope.signal.throwIfAborted();
		return new PluginHttp(this.#router, ownerId, scope);
	}

	close(): Promise<void> {
		return (this.#closing ??= this.#close());
	}

	#assertHostPath(path: string): void {
		if (/^\/(?:plugins(?:\/|$)|:)/u.test(path)) throw new CodedError('HTTP_ROUTE_PATH_RESERVED');
	}

	#acceptHost(authority: string | undefined): boolean {
		const address = this.#server.address();
		return (
			!!address &&
			typeof address !== 'string' &&
			(authority === `${host}:${address.port}` || authority === `localhost:${address.port}`)
		);
	}

	async #listen(signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();
		this.#server.listen(this.#port, host);
		await once(this.#server, 'listening');
		signal.throwIfAborted();
		if (this.#closing) throw new CodedError('HTTP_SERVER_CLOSED');
		this.#log.report({ source: 'http', level: 'info', code: 'HTTP_LISTENING', params: { origin: this.origin } });
	}

	async #close(): Promise<void> {
		await this.#starting?.catch(() => undefined);
		this.#detachUpgrade?.();
		const routes = this.#router.close();
		const listener = new Promise<void>((resolve, reject) => {
			if (!this.#server.listening) {
				resolve();
				return;
			}
			this.#server.close((cause) => (cause ? reject(cause) : resolve()));
			// 处理函数由路由排空。关闭连接也会取消尚在接收请求体的客户端。
			this.#server.closeAllConnections();
		});
		await Promise.all([listener, routes]);
	}
}
