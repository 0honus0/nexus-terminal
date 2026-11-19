import { addAbortListener } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { AuthApi, AuthConnectionPermit } from '../../auth/node/auth-api.js';
import type { HttpApi, HttpUpgradeHandler } from '../../http/node/http-api.js';
import type { LogApi } from '../../log/node/log-api.js';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';
import { CodedError } from '../../utils/error.js';
import { PluginWs, type PluginWsApi, type WsRoute } from './ws-plugin-api.js';

type WsAccess = 'session' | 'public';

interface WsRegistration {
	readonly access: WsAccess;
	readonly signal: AbortSignal;
	readonly server: WebSocketServer;
	readonly pending: Set<Promise<void>>;
	readonly handler: WsRoute['handler'];
	close(): Promise<void>;
}

interface WsClient {
	readonly route: WsRegistration;
	readonly permit: AuthConnectionPermit | undefined;
	alive: boolean;
	checking: boolean;
}

interface WsOptions {
	readonly services: {
		readonly http: Pick<HttpApi, 'attachUpgrade'>;
		readonly auth: Pick<AuthApi, 'authorizeUpgrade'>;
		readonly log: Pick<LogApi, 'report'>;
	};
}

const routePath = /^\/(?:[\w~-]+(?:\.[\w~-]+)*)(?:\/[\w~-]+(?:\.[\w~-]+)*)*$/u;

function rejectUpgrade(socket: Duplex, status: 401 | 404 | 503): void {
	if (!socket.destroyed && !socket.writableEnded) {
		socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
	}
}

/** 复用 HTTP 监听器，在已登记路径上用 ws 处理 Upgrade。 */
export class WsApi {
	readonly #http: WsOptions['services']['http'];
	readonly #auth: WsOptions['services']['auth'];
	readonly #log: WsOptions['services']['log'];
	readonly #routes = new Map<string, WsRegistration>();
	readonly #clients = new Map<WebSocket, WsClient>();
	readonly #draining = new Set<Promise<void>>();
	readonly #controller = new AbortController();
	#detach: (() => void) | undefined;
	#heartbeat: ReturnType<typeof setInterval> | undefined;
	#closing: Promise<void> | undefined;

	constructor({ services: { http, auth, log } }: WsOptions) {
		this.#http = http;
		this.#auth = auth;
		this.#log = log;
	}

	initialize(signal: AbortSignal): void {
		this.#controller.signal.throwIfAborted();
		signal.throwIfAborted();
		if (this.#detach) return;
		this.#detach = this.#http.attachUpgrade(this.#upgrade);
		this.#heartbeat = setInterval(() => this.#checkClients(), 15_000);
		this.#heartbeat.unref();
	}

	register(route: WsRoute, { access = 'session' }: { access?: WsAccess } = {}): () => Promise<void> {
		if (/^\/plugins(?:\/|$)/u.test(route.path)) throw new CodedError('WS_ROUTE_PATH_RESERVED');
		return this.#register('/api', undefined, route, access);
	}

	bind(ownerId: string, scope: PluginScopeApi): PluginWsApi {
		scope.signal.throwIfAborted();
		const prefix = `/api/plugins/${encodeURIComponent(ownerId)}`;
		return new PluginWs((route) => this.#register(prefix, scope, route, 'session'));
	}

	close(): Promise<void> {
		return (this.#closing ??= this.#close());
	}

	#register(
		prefix: string,
		owner: PluginScopeApi | undefined,
		{ path, maxPayload = 65_536, lifetime, handler }: WsRoute,
		access: WsAccess,
	): () => Promise<void> {
		const controller = new AbortController();
		const parents = [this.#controller.signal, controller.signal];
		if (owner) parents.push(owner.signal);
		if (lifetime) parents.push(lifetime.signal);
		const signal = AbortSignal.any(parents);
		signal.throwIfAborted();
		if (path !== '/' && !routePath.test(path)) throw new CodedError('WS_ROUTE_PATH_INVALID');
		// ws 的 Receiver 使用有符号 32 位整数存储此上限。
		if (!Number.isInteger(maxPayload) || maxPayload < 1 || maxPayload > 0x7fffffff)
			throw new CodedError('WS_MAX_PAYLOAD_INVALID');
		const key = prefix + (path === '/' ? '' : path);
		if (this.#routes.has(key)) throw new CodedError('WS_ROUTE_DUPLICATE');

		const server = new WebSocketServer({ noServer: true, maxPayload, perMessageDeflate: false });
		const pending = new Set<Promise<void>>();
		const unregister: (() => void)[] = [];
		let closing: Promise<void> | undefined;
		const route: WsRegistration = {
			access,
			signal,
			server,
			pending,
			handler,

			close: () => {
				if (closing) return closing;
				const drained = Promise.resolve()
					.then(async () => {
						for (const client of server.clients) client.terminate();
						await Promise.all([
							new Promise<void>((resolve) => server.close(() => resolve())),
							Promise.allSettled(pending),
						]);
					})
					.finally(() => {
						this.#draining.delete(drained);
						for (const remove of unregister) remove();
					});
				closing = drained;
				this.#draining.add(drained);
				if (this.#routes.get(key) === route) this.#routes.delete(key);
				controller.abort(new CodedError('WS_ROUTE_CLOSED'));
				return drained;
			},
		};
		server.on('error', () => this.#reportFailure('WS_SERVER_FAILED'));
		this.#routes.set(key, route);
		signal.addEventListener('abort', () => void route.close(), { once: true });
		try {
			if (owner) unregister.push(owner.onDispose(route.close));
			if (lifetime) unregister.push(lifetime.onDispose(route.close));
		} catch (cause) {
			void route.close();
			throw cause;
		}
		return route.close;
	}

	readonly #upgrade: HttpUpgradeHandler = (request, socket, head) => {
		const url = request.url ?? '';
		const delimiter = url.indexOf('?');
		const path = delimiter === -1 ? url : url.slice(0, delimiter);
		const route = this.#routes.get(path);
		if (!route) {
			rejectUpgrade(socket, 404);
			return;
		}
		const query = new URLSearchParams(delimiter === -1 ? '' : url.slice(delimiter + 1));
		this.#track(route, this.#accept(route, request, socket, head, query));
	};

	async #accept(
		route: WsRegistration,
		request: IncomingMessage,
		socket: Duplex,
		head: Buffer,
		query: URLSearchParams,
	): Promise<void> {
		const closed = new AbortController();
		const signal = AbortSignal.any([route.signal, closed.signal]);
		let permit: AuthConnectionPermit | undefined;
		let connection: WebSocket | undefined;

		const disconnect = () => closed.abort(new CodedError('WS_CONNECTION_CLOSED'));

		socket.once('close', disconnect);
		const timeout = setTimeout(() => socket.destroy(), 10_000);
		timeout.unref();
		using cancelled = addAbortListener(route.signal, () => {
			if (!connection) rejectUpgrade(socket, 503);
		});
		try {
			signal.throwIfAborted();
			if (route.access === 'session') {
				permit = await this.#auth.authorizeUpgrade(request, signal);
				// 会话查询期间，插件可能已停用，或连接已断开。
				signal.throwIfAborted();
				if (!permit || permit.signal.aborted) {
					rejectUpgrade(socket, 401);
					return;
				}
			}
			if (socket.destroyed) return;
			route.server.handleUpgrade(request, socket, head, (client) => {
				connection = client;
			});
			if (!connection) return;
			clearTimeout(timeout);
			const lifetime = permit?.signal ?? signal;
			await this.#serve(route, connection, query, lifetime, permit);
		} catch {
			if (!signal.aborted) this.#reportFailure('WS_CONNECTION_FAILED');
			if (connection) connection.terminate();
			else rejectUpgrade(socket, 503);
		} finally {
			clearTimeout(timeout);
			if (!connection) {
				socket.off('close', disconnect);
				permit?.dispose();
			}
		}
	}

	async #serve(
		route: WsRegistration,
		socket: WebSocket,
		query: URLSearchParams,
		signal: AbortSignal,
		permit: AuthConnectionPermit | undefined,
	): Promise<void> {
		const client: WsClient = { route, permit, alive: true, checking: false };
		this.#clients.set(socket, client);
		socket.on('error', () => this.#reportFailure('WS_CLIENT_FAILED'));
		socket.on('pong', () => {
			client.alive = true;
		});

		const revoke = () => {
			if (route.signal.aborted) socket.terminate();
			else this.#expire(socket);
		};

		const abort = addAbortListener(signal, revoke);
		socket.once('close', () => {
			abort[Symbol.dispose]();
			permit?.dispose();
			this.#clients.delete(socket);
		});
		signal.throwIfAborted();
		await route.handler(socket, { query, signal });
	}

	#expire(socket: WebSocket): void {
		// close 先发起握手。先停止业务消息，避免已撤销的会话在 CLOSING 时继续调用业务。
		socket.removeAllListeners('message');
		socket.close(4001, 'CONNECTION_EXPIRED');
	}

	#checkClients(): void {
		for (const [socket, client] of this.#clients) {
			if (!client.alive) {
				socket.terminate();
				continue;
			}
			if (socket.readyState !== WebSocket.OPEN) continue;
			client.alive = false;
			socket.ping();
			if (client.permit && !client.checking) this.#track(client.route, this.#validate(socket, client));
		}
	}

	async #validate(socket: WebSocket, client: WsClient): Promise<void> {
		client.checking = true;
		try {
			if (!(await client.permit?.validate()) && this.#clients.has(socket)) this.#expire(socket);
		} catch {
			this.#reportFailure('WS_SESSION_CHECK_FAILED');
			if (this.#clients.has(socket)) this.#expire(socket);
		} finally {
			client.checking = false;
		}
	}

	#track(route: WsRegistration, operation: Promise<void>): void {
		route.pending.add(operation);

		const release = () => route.pending.delete(operation);

		void operation.then(release, release);
	}

	async #close(): Promise<void> {
		clearInterval(this.#heartbeat);
		this.#detach?.();
		this.#controller.abort(new CodedError('WS_SERVER_CLOSED'));
		await Promise.all(this.#draining);
	}

	#reportFailure(code: string): void {
		this.#log.report({ source: 'ws', level: 'error', code });
	}
}
