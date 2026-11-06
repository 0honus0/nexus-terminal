import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import type { Logger, LogSeverity } from '../logging/logger.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { MAX_HTTP_BODY_BYTES, DEFAULT_JSON_BODY_BYTES, MAX_WEBSOCKET_FRAME_BYTES } from './http-limits.js';
import type { HttpBindings, HttpRoute, HttpWebSocketRoute } from './http-types.js';
import { bindRequestCookies, firstHeader, validateOrigin } from './http-request.js';
import { HttpInputFailure } from './http-errors.js';
import { waitForResponse } from './http-lifecycle.js';
import { bindDiagnosticContext, logDiagnostic, withDiagnosticContext } from '../logging/diagnostic-log.js';

export interface CompiledHttpBindings {
	origins: readonly URL[];
	webSockets: ReadonlyMap<string, HttpWebSocketRoute>;
	prepareUpgradeCookies(request: IncomingMessage): void;
	handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
	close(): Promise<void>;
}

/** Fastify owns routing/parsing/replies; this generation owns work beyond a disconnected response. */
export async function compileHttpBindings(
	publicOrigin: string,
	bindings: HttpBindings,
	trust: (address: string, index: number) => boolean,
	logger?: Logger,
): Promise<CompiledHttpBindings> {
	const origin = new URL(publicOrigin);
	if (!['http:', 'https:'].includes(origin.protocol) || origin.href !== origin.origin + '/') {
		throw new Error('Invalid external HTTP origin');
	}
	const origins = [origin];
	for (const raw of bindings.allowedOrigins ?? []) {
		const extra = new URL(raw);
		if (raw !== extra.origin || extra.protocol !== origin.protocol) {
			throw new Error('Invalid additional HTTP origin');
		}
		if (!origins.some((current) => current.origin === extra.origin)) {
			origins.push(extra);
		}
	}
	const webSockets = new Map<string, HttpWebSocketRoute>();
	for (const route of bindings.webSockets ?? []) {
		if (
			webSockets.has(route.path) ||
			!!route.connected === !!route.connectedRaw ||
			[route.maxTextMessageBytes, route.maxBufferedTextBytes, route.maxBinaryMessageBytes].some(
				(value) =>
					value !== undefined &&
					(!Number.isSafeInteger(value) || value < 1 || value > MAX_WEBSOCKET_FRAME_BYTES),
			)
		) {
			throw new Error('Invalid or duplicate WebSocket route');
		}
		webSockets.set(route.path, route);
	}
	const app = Fastify({
		logger: false,
		trustProxy: trust,
		bodyLimit: DEFAULT_JSON_BODY_BYTES,
		exposeHeadRoutes: false,
		routerOptions: {
			maxParamLength: 2048,

			// Fastify preserves the parser result unchanged; its declaration assumes an indexed object.
			querystringParser: (query) => new URLSearchParams(query) as URLSearchParams & Record<string, unknown>,
		},

		frameworkErrors(error, request: FastifyRequest, reply: FastifyReply) {
			void track(request.raw, async () => {
				try {
					validateOrigin(request.raw, origins, trust(request.raw.socket.remoteAddress ?? '', 0));
					await admitUnmatched(request.ip);
					const failure = httpFailure(error);
					sendHttpFailure(reply, failure);
				} catch (cause) {
					const failure = httpFailure(cause);
					sendHttpFailure(reply, failure);
				}
			}).catch((cause: unknown) => {
				logDiagnostic(logger, 'error', 'HTTP_FRAMEWORK_REJECTION_FAILED', {}, cause);
				reply.raw.destroy();
			});
		},

		ajv: { customOptions: { coerceTypes: false, useDefaults: false, removeAdditional: false } },
	});
	const work = new WeakMap<IncomingMessage, Set<Promise<unknown>>>();

	function track<T>(request: IncomingMessage, action: () => T | Promise<T>): Promise<T> {
		const tasks = work.get(request);
		const task = Promise.resolve().then(action);
		tasks?.add(task);
		void task.finally(() => tasks?.delete(task)).catch(() => undefined);
		return task;
	}

	const routeNames = new WeakMap<IncomingMessage, string>();
	app.decorateRequest('origin', '');
	app.removeAllContentTypeParsers();
	const jsonParser = app.getDefaultJsonParser('error', 'error');
	app.addContentTypeParser<Buffer>('application/json', { parseAs: 'buffer' }, (request, bytes, done) => {
		try {
			if (
				!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(String(request.headers['content-type']).trim())
			) {
				throw new HttpInputFailure(415, 'unsupported_media_type');
			}
			const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
			jsonParser(request, source, (error, value) =>
				done(error ? new HttpInputFailure(400, 'invalid_json', { cause: error }) : null, value),
			);
		} catch (error) {
			done(error instanceof HttpInputFailure ? error : new HttpInputFailure(400, 'invalid_json'));
		} finally {
			bytes.fill(0);
		}
	});
	app.addHook('onRequest', async (request, reply) => {
		const expected = validateOrigin(request.raw, origins, trust(request.raw.socket.remoteAddress ?? '', 0));
		const url = new URL(request.raw.url ?? '/', expected);
		if (url.origin !== expected.origin) {
			throw new HttpInputFailure(400, 'invalid_path');
		}
		request.origin = expected.origin;
		routeNames.set(request.raw, request.routeOptions.url ?? 'unmatched');
		logDiagnostic(logger, 'debug', 'HTTP_REQUEST_STARTED', {
			route: request.routeOptions.url ?? 'unmatched',
			method: request.method,
		});
		reply.header('Cache-Control', 'no-store');
		if (!request.routeOptions.url) {
			await track(request.raw, () => admitUnmatched(request.ip));
		}
	});
	app.setErrorHandler((error, request, reply) => {
		const failure = httpFailure(error);
		logDiagnostic(
			logger,
			failure.status >= 500 ? 'error' : 'warn',
			'HTTP_HANDLER_FAILED',
			{
				route: request.routeOptions.url ?? 'unmatched',
				method: request.method,
			},
			error,
		);
		if (reply.raw.headersSent || reply.raw.destroyed) {
			reply.raw.destroy();
			return;
		}
		sendHttpFailure(reply, failure);
	});

	async function admitUnmatched(sourceIp: string): Promise<void> {
		if (!bindings.admitUnmatched) {
			return;
		}
		let allowed: boolean;
		try {
			allowed = await bindings.admitUnmatched(sourceIp);
		} catch (cause) {
			throw new HttpInputFailure(503, 'internal_failure', { cause });
		}
		if (!allowed) {
			throw new HttpInputFailure(403, 'forbidden');
		}
	}

	app.setNotFoundHandler(async (_request, reply) => {
		return reply.code(404).send({ code: 'not_found' });
	});

	function install(instance: FastifyInstance, definition: HttpRoute): void {
		if (
			[definition.bodyLimit, definition.config?.multipartBodyLimit].some(
				(limit) =>
					limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_HTTP_BODY_BYTES),
			) ||
			(definition.config?.rawBody && definition.config.multipartBodyLimit !== undefined)
		) {
			throw new Error('Invalid HTTP route budget');
		}
		const route: HttpRoute = { ...definition };
		// Native hooks may outlive response closure. Preserve Fastify's callback/Promise
		// contract while keeping the actual hook task in the maintenance drain.
		for (const key of [
			'onRequest',
			'preParsing',
			'preValidation',
			'preHandler',
			'preSerialization',
			'onSend',
			'onResponse',
			'onError',
			'onTimeout',
			'onRequestAbort',
		] as const) {
			const hooks = route[key];
			if (!hooks) {
				continue;
			}
			const wrapped = (Array.isArray(hooks) ? hooks : [hooks]).map((hook) => {
				return function (this: FastifyInstance, ...args: unknown[]): Promise<unknown> {
					// All Fastify route hooks receive FastifyRequest first and callback last.
					const request = args[0] as FastifyRequest;
					const response = key === 'onRequestAbort' ? undefined : (args[1] as FastifyReply).raw;
					return track(request.raw, () => {
						let asynchronous = false;

						let completed: () => void = () => undefined;

						const finished = () => {
							if (!asynchronous) {
								completed();
							}
						};

						const pending = new Promise<unknown>((resolve, reject) => {
							completed = () => resolve(undefined);
							// Callback hooks may end the reply without calling done (native early exit).
							// An aborted socket is not completion; late async work still owns its task.
							response?.once('finish', finished);

							const done = (error?: Error | null, value?: unknown) =>
								error ? reject(error) : resolve(value);

							const invoke = hook as (this: FastifyInstance, ...values: unknown[]) => unknown;
							const result = invoke.apply(this, [...args.slice(0, -1), done]);
							asynchronous =
								!!result &&
								typeof result === 'object' &&
								'then' in result &&
								typeof result.then === 'function';
							if (asynchronous) {
								Promise.resolve(result).then(resolve, reject);
							}
						});
						return pending.finally(() => response?.off('finish', finished));
					});
				};
			});
			// The array keeps each hook's native argument shape; casts stay at the framework boundary.
			Object.assign(route, { [key]: wrapped });
		}
		const handler = definition.handler;
		route.handler = async function (request, reply) {
			if (request.raw.aborted || reply.raw.destroyed) {
				return;
			}
			return track(request.raw, async () => {
				const result = await handler.call(this, request, reply);
				// An explicit send may still be in asynchronous serialization/audit hooks.
				// Await Fastify's reply thenable so it cannot auto-send an empty second reply.
				return result === undefined ? reply : result;
			});
		};
		instance.route(route);
	}

	try {
		// The plugin types expose serialization options only; its documented parser
		// also accepts decode. Keep opaque tokens unchanged and the standard encoder.
		const cookieParseOptions = {
			decode: (value: string) => value,

			encode: encodeURIComponent,
		};
		await app.register(cookie, { parseOptions: cookieParseOptions });
		app.addHook('onRequest', async (request) => {
			bindRequestCookies(request.raw, request.cookies);
		});
		// Keep the existing policy. Unrelated defaults change iframe, cross-origin
		// SDK, HTTP deployment and remote desktop behavior.
		await app.register(helmet, {
			contentSecurityPolicy: false,
			crossOriginEmbedderPolicy: false,
			crossOriginOpenerPolicy: false,
			crossOriginResourcePolicy: false,
			originAgentCluster: false,
			referrerPolicy: false,
			strictTransportSecurity: false,
			xContentTypeOptions: true,
			xDnsPrefetchControl: false,
			xDownloadOptions: false,
			xFrameOptions: false,
			xPermittedCrossDomainPolicies: false,
			xPoweredBy: false,
			xXssProtection: false,
		});
		const multipartRoutes = bindings.routes.filter((route) => route.config?.multipartBodyLimit !== undefined);
		if (multipartRoutes.length) {
			app.register(async (scope) => {
				await scope.register(multipart, { attachFieldsToBody: false });
				scope.addHook('preParsing', async (request, _reply, payload) => {
					if (/^multipart\/form-data(?:\s*;|$)/iu.test(request.headers['content-type'] ?? '')) {
						const length = request.headers['content-length'];
						const limit = request.routeOptions.config.multipartBodyLimit ?? request.routeOptions.bodyLimit;
						if (length !== undefined && (!/^(0|[1-9]\d*)$/.test(length) || Number(length) > limit)) {
							throw new HttpInputFailure(413, 'body_too_large');
						}
					}
					// Multipart consumes request.raw itself. Returning a piped transform would
					// create an unread second consumer; readMultipart counts the live raw bytes.
					return payload;
				});
				for (const route of multipartRoutes) {
					install(scope, route);
				}
			});
		}
		for (const route of bindings.routes) {
			if (route.config?.multipartBodyLimit !== undefined) {
				continue;
			} else if (route.config?.rawBody) {
				app.register(async (scope) => {
					scope.removeAllContentTypeParsers();
					scope.addContentTypeParser('*', (_request, payload, done) => done(null, payload));
					install(scope, route);
				});
			} else {
				install(app, route);
			}
		}
		await app.ready();
	} catch (error) {
		await app.close();
		throw error;
	}
	return {
		origins,
		webSockets,

		prepareUpgradeCookies(request) {
			bindRequestCookies(request, app.parseCookie(firstHeader(request, 'cookie') ?? ''));
		},

		close: () => app.close(),

		handle: (request, response) =>
			withDiagnosticContext({ requestId: randomUUID() }, async () => {
				const tasks = new Set<Promise<unknown>>();
				work.set(request, tasks);
				const completed = waitForResponse(response, request);
				const started = Date.now();
				const method = request.method ?? 'OTHER';
				const finish = bindDiagnosticContext(() => {
					const status = response.statusCode;
					const responseFinished = response.writableFinished && !request.aborted;
					const severity: LogSeverity =
						status >= 500
							? 'error'
							: !responseFinished || status >= 400
								? 'warn'
								: method === 'GET'
									? 'debug'
									: 'info';
					logDiagnostic(logger, severity, 'HTTP_REQUEST_COMPLETED', {
						route: routeNames.get(request) ?? 'unmatched',
						method,
						status,
						responseFinished,
						durationMs: Date.now() - started,
					});
				});
				try {
					app.routing(request, response);
					await completed;
					while (tasks.size) {
						await Promise.allSettled([...tasks]);
					}
				} finally {
					work.delete(request);
					finish();
				}
			}),
	};
}

function httpFailure(error: unknown): HttpInputFailure {
	if (error instanceof HttpInputFailure) {
		return error;
	}
	const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : null;
	switch (code) {
		case 'FST_ERR_CTP_BODY_TOO_LARGE':
			return new HttpInputFailure(413, 'body_too_large');
		case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
			return new HttpInputFailure(415, 'unsupported_media_type');
		case 'FST_ERR_CTP_INVALID_JSON_BODY':
		case 'FST_ERR_CTP_EMPTY_JSON_BODY':
			return new HttpInputFailure(400, 'invalid_json');
		case 'FST_ERR_CTP_INVALID_CONTENT_LENGTH':
			return new HttpInputFailure(400, 'invalid_body');
		case 'FST_ERR_MAX_PARAM_LENGTH':
		case 'FST_ERR_BAD_URL':
			return new HttpInputFailure(400, 'invalid_path');
		default:
			return new HttpInputFailure(500, 'internal_failure');
	}
}

/** Terminal technical failures bypass failed user hooks and Fastify's message-bearing fallback. */
function sendHttpFailure(reply: FastifyReply, failure: HttpInputFailure): void {
	const response = reply.raw;
	if (response.headersSent || response.destroyed || response.writableEnded) {
		response.destroy();
		return;
	}
	reply.hijack();
	// Native streaming may have staged entity headers before its first chunk fails.
	// No successful payload metadata or credential can describe this safe error body.
	for (const name of response.getHeaderNames()) {
		response.removeHeader(name);
	}
	response.writeHead(failure.status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
	});
	response.end(JSON.stringify({ code: failure.code }));
}
