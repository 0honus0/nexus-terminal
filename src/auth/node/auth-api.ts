import type { Request, RequestHandler } from 'express';
import { MemoryStore, rateLimit } from 'express-rate-limit';
import session from 'express-session';
import pLimit from 'p-limit';
import { z } from 'zod';
import type { CryptoApi } from '../../crypto/node/crypto-api.js';
import type { DatabaseApi } from '../../database/node/database-api.js';
import { HttpFailure, type HttpApi, type HttpAuthenticate, type HttpHostRoute } from '../../http/node/http-api.js';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';
import type { PluginReadiness } from '../../plugin/plugin-state-types.js';
import { CodedError } from '../../utils/error.js';
import {
	AuthAccountSchema,
	AuthChangePasswordSchema,
	AuthCredentialsSchema,
	AuthStateSchema,
	authInitializePath,
	authLoginPath,
	authLogoutPath,
	authPasswordPath,
	authStatePath,
} from '../auth-http-types.js';
import { AuthMethods, type AuthMethodApi } from './auth-method-api.js';
import { authSessionMaxAge, AuthSessionStore, AuthStorage } from './auth-storage.js';

const cookieName = 'nexus.sid';
const cookie = { httpOnly: true, sameSite: 'strict', path: '/' } as const;
const empty = z.strictObject({});

export interface AuthConnectionPermit {
	readonly signal: AbortSignal;
	validate(): Promise<boolean>;
	dispose(): void;
}

interface UpgradeSession {
	readonly request: Request;
	readonly controller: AbortController;
}

interface AuthOptions {
	readonly services: {
		readonly database: Pick<DatabaseApi, 'withClient' | 'migrateHost'>;
		readonly crypto: Pick<CryptoApi, 'hash' | 'verify'>;
	};
}

/** 负责单 owner 账号、服务器端会话，以及本体认证路由的登记。 */
export class AuthApi {
	readonly #storage: AuthStorage;
	readonly #sessionStore: AuthSessionStore;
	readonly #crypto: Pick<CryptoApi, 'hash' | 'verify'>;
	readonly #work = pLimit(1);
	readonly #upgradeSessions = new Set<UpgradeSession>();
	readonly #methods: AuthMethods;
	readonly #rateStore = new MemoryStore();
	readonly #rateLimit = rateLimit({
		store: this.#rateStore,
		windowMs: 60_000,
		limit: 10,
		standardHeaders: 'draft-8',
		legacyHeaders: false,

		handler() {
			throw new HttpFailure(429, 'AUTH_RATE_LIMITED');
		},
	});
	#session: RequestHandler | undefined;
	#http: Pick<HttpApi, 'register'> | undefined;

	constructor({ services: { database, crypto } }: AuthOptions) {
		this.#storage = new AuthStorage(database);
		this.#sessionStore = new AuthSessionStore(database);
		this.#crypto = crypto;

		this.#methods = new AuthMethods({
			cookieName,

			getHttp: () => (this.#session ? this.#http : undefined),

			completeLogin: (request, signal, assertCurrent) =>
				this.#completeMethodLogin(request, signal, assertCurrent),

			destroySession: (request) => this.#destroySession(request),
		});
	}

	async initialize(signal: AbortSignal): Promise<void> {
		await this.#storage.initialize(signal);
		signal.throwIfAborted();
		const secret = await this.#storage.getOrCreateSessionSecret();
		signal.throwIfAborted();
		this.#session = session({
			name: cookieName,
			secret,
			store: this.#sessionStore,
			resave: false,
			saveUninitialized: false,
			cookie: { ...cookie, secure: 'auto', maxAge: authSessionMaxAge },
		});
	}

	close(): void {
		this.#session = undefined;
		this.#methods.clear();
		this.#revokeConnections();
		this.#rateStore.shutdown();
	}

	readonly authenticate: HttpAuthenticate = async (request, response, signal) => {
		const load = this.#session;
		if (!load) throw new CodedError('AUTH_NOT_READY');
		await new Promise<void>((resolve, reject) => {
			load(request, response, (cause?: unknown) => (cause ? reject(cause) : resolve()));
		});
		signal.throwIfAborted();
		return this.#hasIdentity(request, signal);
	};

	async authorizeUpgrade(message: IncomingMessage, signal: AbortSignal): Promise<AuthConnectionPermit | undefined> {
		signal.throwIfAborted();
		// express-session 读取 Node 请求并在 Store 查询之前填好 sessionID。
		const request = message as Request;
		const upgrade: UpgradeSession = { request, controller: new AbortController() };
		const lifetime = AbortSignal.any([signal, upgrade.controller.signal]);
		let expiry: ReturnType<typeof setTimeout> | undefined;
		let granted = false;

		const dispose = () => {
			this.#upgradeSessions.delete(upgrade);
			clearTimeout(expiry);
			lifetime.removeEventListener('abort', dispose);
		};

		this.#upgradeSessions.add(upgrade);
		lifetime.addEventListener('abort', dispose, { once: true });
		try {
			const response = new ServerResponse(message) as Parameters<HttpAuthenticate>[1];
			if (!(await this.authenticate(request, response, lifetime)) || lifetime.aborted) return;
			const deadline = request.session.cookie.expires?.getTime();
			if (deadline !== undefined && deadline <= Date.now()) return;
			if (deadline !== undefined) {
				expiry = setTimeout(
					() => upgrade.controller.abort(new CodedError('AUTH_SESSION_EXPIRED')),
					deadline - Date.now(),
				);
				expiry.unref();
			}
			granted = true;
			return {
				signal: lifetime,
				dispose,

				validate: async () => {
					if (lifetime.aborted) return false;
					try {
						const reloaded = await new Promise<boolean>((resolve) => {
							request.session.reload((cause: unknown) => resolve(!cause));
						});
						if (reloaded && !lifetime.aborted && (await this.#hasIdentity(request, lifetime))) return true;
					} catch (cause) {
						if (!lifetime.aborted) {
							upgrade.controller.abort(new CodedError('AUTH_SESSION_EXPIRED'));
							throw cause;
						}
					}
					upgrade.controller.abort(new CodedError('AUTH_SESSION_EXPIRED'));
					return false;
				},
			};
		} catch (cause) {
			if (!lifetime.aborted) throw cause;
			return undefined;
		} finally {
			if (!granted) dispose();
		}
	}

	async #hasIdentity(request: Request, signal: AbortSignal): Promise<boolean> {
		if (request.session?.identityVersion === undefined) return false;
		const owner = await this.#storage.getOwner();
		signal.throwIfAborted();
		return owner?.version === request.session.identityVersion;
	}

	#revokeConnections(sessionId?: string): void {
		for (const { request, controller } of this.#upgradeSessions) {
			if (sessionId === undefined || request.sessionID === sessionId) {
				controller.abort(new CodedError('AUTH_SESSION_EXPIRED'));
			}
		}
	}

	register(http: Pick<HttpApi, 'register'>): void {
		const publicRoute = { access: 'public' } as const;
		const publicPassword = { ...publicRoute, beforeBody: this.#rateLimit };

		http.register([
			{
				policy: publicRoute,
				method: 'get',
				path: authStatePath,
				input: empty,
				output: AuthStateSchema,
				handler: this.#readState,
			},
			{
				policy: publicPassword,
				method: 'post',
				path: authInitializePath,
				input: AuthCredentialsSchema,
				output: AuthAccountSchema,
				status: 201,
				handler: this.#initializeOwner,
			},
			{
				policy: publicPassword,
				method: 'post',
				path: authLoginPath,
				input: AuthCredentialsSchema,
				output: AuthAccountSchema,
				handler: this.#login,
			},
			{
				policy: publicRoute,
				method: 'post',
				path: authLogoutPath,
				input: empty,
				output: empty,
				status: 204,
				handler: this.#logout,
			},
			{
				policy: { beforeBody: this.#rateLimit },
				method: 'post',
				path: authPasswordPath,
				input: AuthChangePasswordSchema,
				output: empty,
				status: 204,
				handler: this.#changePassword,
			},
		]);
		this.#http = http;
	}

	/** 运行时交付真实插件身份及就绪状态，插件只能在自己的命名空间登记。 */
	bindMethods(pluginId: string, scope: PluginScopeApi, readiness: () => PluginReadiness | undefined): AuthMethodApi {
		return this.#methods.bind(pluginId, scope, readiness);
	}

	/** 每次读取当前可用的登录方式，供宿主决定匿名资源的范围。 */
	loginProviders(): readonly string[] {
		return [...new Set(this.#methods.list().flatMap(({ pluginId }) => (pluginId === null ? [] : [pluginId])))];
	}

	async #completeMethodLogin(request: Request, signal: AbortSignal, assertCurrent: () => void): Promise<void> {
		assertCurrent();
		const owner = await this.#storage.getOwner();
		assertCurrent();
		if (!owner) throw new HttpFailure(409, 'AUTH_ACCOUNT_UNINITIALIZED');
		await this.#establish(request, signal, owner.version, assertCurrent);
	}

	readonly #readState: HttpHostRoute<typeof empty, typeof AuthStateSchema>['handler'] = async (
		_input,
		signal,
		{ request },
	) => {
		const owner = await this.#storage.getOwner();
		signal.throwIfAborted();
		return {
			initialized: !!owner,
			account:
				owner && owner.version === request.session?.identityVersion
					? { id: owner.id, username: owner.username }
					: null,
			methods: [
				{ pluginId: null, id: 'password', label: 'auth.password', baseURL: '/api/auth/' },
				...this.#methods.list(),
			],
		};
	};

	readonly #initializeOwner: HttpHostRoute<typeof AuthCredentialsSchema, typeof AuthAccountSchema>['handler'] =
		async ({ username, password }, signal, { request }) => {
			if (await this.#storage.getOwner()) throw new HttpFailure(409, 'AUTH_ALREADY_INITIALIZED');
			const passwordHash = await this.#passwordWork(signal, () => this.#crypto.hash(password));
			const owner = await this.#storage.createOwner(username, passwordHash);
			if (!owner) throw new HttpFailure(409, 'AUTH_ALREADY_INITIALIZED');
			await this.#establish(request, signal, owner.version);
			return { id: owner.id, username: owner.username };
		};

	readonly #login: HttpHostRoute<typeof AuthCredentialsSchema, typeof AuthAccountSchema>['handler'] = async (
		{ username, password },
		signal,
		{ request },
	) => {
		const owner = await this.#storage.getOwner();
		if (
			!owner ||
			!(await this.#passwordWork(signal, () => this.#crypto.verify(owner.passwordHash, password))) ||
			owner.username !== username
		) {
			throw new HttpFailure(401, 'AUTH_INVALID_CREDENTIALS');
		}
		await this.#establish(request, signal, owner.version);
		return { id: owner.id, username: owner.username };
	};

	readonly #logout: HttpHostRoute<typeof empty, typeof empty>['handler'] = async (
		_input,
		_signal,
		{ request, response },
	) => {
		if (request.session) await this.#destroySession(request);
		response.clearCookie(cookieName, cookie);
		return {};
	};

	readonly #changePassword: HttpHostRoute<typeof AuthChangePasswordSchema, typeof empty>['handler'] = async (
		{ currentPassword, newPassword },
		signal,
		{ request },
	) => {
		const owner = await this.#storage.getOwner();
		if (
			!owner ||
			owner.version !== request.session.identityVersion ||
			!(await this.#passwordWork(signal, () => this.#crypto.verify(owner.passwordHash, currentPassword)))
		) {
			throw new HttpFailure(401, 'AUTH_INVALID_CREDENTIALS');
		}
		const passwordHash = await this.#passwordWork(signal, () => this.#crypto.hash(newPassword));
		const version = await this.#storage.changeOwnerPassword(owner.version, passwordHash);
		if (version === undefined) throw new HttpFailure(401, 'AUTH_INVALID_CREDENTIALS');
		this.#revokeConnections();
		await this.#establish(request, signal, version);
		return {};
	};

	#passwordWork<Result>(signal: AbortSignal, task: () => Promise<Result>): Promise<Result> {
		signal.throwIfAborted();
		// Scrypt 单次约占 128 MiB，只允许一个任务计算和一个任务排队。
		if (this.#work.activeCount + this.#work.pendingCount >= 2) throw new HttpFailure(429, 'AUTH_BUSY');
		return this.#work(async () => {
			signal.throwIfAborted();
			const result = await task();
			signal.throwIfAborted();
			return result;
		});
	}

	async #destroySession(request: Request): Promise<void> {
		const sessionId = request.sessionID;
		await new Promise<void>((resolve, reject) => {
			request.session.destroy((cause: unknown) => (cause ? reject(cause) : resolve()));
		});
		this.#revokeConnections(sessionId);
	}

	async #establish(
		request: Request,
		signal: AbortSignal,
		version: number,
		assertCurrent = () => signal.throwIfAborted(),
	): Promise<void> {
		assertCurrent();
		const previous = request.sessionID;
		await new Promise<void>((resolve, reject) => {
			request.session.regenerate((cause: unknown) => (cause ? reject(cause) : resolve()));
		});
		this.#revokeConnections(previous);
		assertCurrent();
		request.session.identityVersion = version;
		try {
			await new Promise<void>((resolve, reject) => {
				request.session.save((cause: unknown) => (cause ? reject(cause) : resolve()));
			});
		} catch (cause) {
			// 清除失败的会话，防止 express-session 在发送响应时自动再次保存。
			await this.#destroySession(request);
			throw cause;
		}
	}
}

import { ServerResponse, type IncomingMessage } from 'node:http';
