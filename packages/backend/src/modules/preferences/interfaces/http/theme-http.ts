import { readRequestCookie } from '../../../../platform/http/http-request.js';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import { readMultipart, type MultipartPart } from '../../../../platform/http/http-body.js';
import { InvalidPayload } from '@nexus-terminal/shared/common/http-codec';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import {
	TERMINAL_THEME_REQUEST_MAX_BYTES,
	TERMINAL_THEME_IMPORT_MAX_BYTES,
	TERMINAL_THEME_MULTIPART_MAX_BYTES,
	TERMINAL_THEME_NAME_MAX_BYTES,
	TERMINAL_THEME_RESPONSE_MAX_BYTES,
	type TerminalThemeErrorCode,
} from '@nexus-terminal/shared/preferences/themes/values';
import {
	readTerminalThemeCreate,
	readTerminalThemeUpdate,
	readTerminalThemeDelete,
	readTerminalThemeId,
	readTerminalThemeColors,
} from '@nexus-terminal/shared/preferences/themes/http-codec';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import { ThemeFailure } from '../../theme-failure.js';
import type { ThemeService } from '../../themes/service/theme-service.js';
import type { TerminalThemeImportRequest } from '@nexus-terminal/shared/preferences/themes/http';
import type { ThemeActor } from '../../themes/model/theme-types.js';
import { toApplicationTheme, toWireTheme, toWireThemeColors } from './theme-mapper.js';
const ERROR_STATUS: Record<TerminalThemeErrorCode, number> = {
	invalid_input: 400,
	unauthenticated: 401,
	forbidden: 403,
	not_found: 404,
	version_conflict: 409,
	name_conflict: 409,
	preset_readonly: 409,
	limit_exceeded: 413,
	storage_unavailable: 503,
	operation_unknown: 503,
	internal_failure: 503,
	unavailable: 503,
	unsupported_media_type: 415,
};

function codeFor(error: unknown): TerminalThemeErrorCode {
	if (error instanceof ThemeFailure) {
		return error.code;
	}
	if (error instanceof HttpInputFailure) {
		return error.status === 413
			? 'limit_exceeded'
			: error.status === 415
				? 'unsupported_media_type'
				: 'invalid_input';
	}
	if (error instanceof InvalidPayload || error instanceof SyntaxError) {
		return 'invalid_input';
	}
	if (
		error instanceof AccessOperationError &&
		(error.code === 'storage_unavailable' || error.code === 'operation_unknown')
	) {
		return error.code;
	}
	return 'internal_failure';
}

async function authenticate(request: HttpRequest, reply: HttpReply, access: AccessPublicApi): Promise<ThemeActor> {
	try {
		const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME);
		const identity = await access.authenticate(token);
		if (!identity || !token) {
			throw new ThemeFailure('unauthenticated');
		}
		return { userId: identity.userId, token };
	} catch (cause) {
		if (cause instanceof ThemeFailure) {
			throw cause;
		}
		throw new ThemeFailure(codeFor(cause), { cause });
	}
}

async function revalidate(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
	actor: ThemeActor,
): Promise<void> {
	const current = await authenticate(request, reply, access);
	if (current.userId !== actor.userId || current.token !== actor.token) {
		throw new ThemeFailure('forbidden');
	}
}

function ready(request: HttpRequest, reply: HttpReply): void {
	if (reply.raw.destroyed || reply.raw.writableEnded) {
		throw new ThemeFailure('unavailable');
	}
}

function send(request: HttpRequest, reply: HttpReply, status: number, body: unknown, mutation = false): void {
	ready(request, reply);
	reply.type('application/json; charset=utf-8').serializer((payload) => {
		try {
			const encoded = JSON.stringify(payload);
			if (encoded === undefined) {
				throw new ThemeFailure('internal_failure');
			}
			if (Buffer.byteLength(encoded, 'utf8') > TERMINAL_THEME_RESPONSE_MAX_BYTES) {
				throw new ThemeFailure('limit_exceeded');
			}
			return encoded;
		} catch (cause) {
			throw new ThemeFailure(
				mutation ? 'operation_unknown' : cause instanceof ThemeFailure ? cause.code : 'internal_failure',
				{ cause },
			);
		}
	});
	reply.code(status).send(body);
}

async function deliver(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
	actor: ThemeActor,
	status: number,
	project: () => unknown,
): Promise<void> {
	try {
		await revalidate(request, reply, access, actor);
		send(request, reply, status, project(), true);
	} catch (cause) {
		throw new ThemeFailure('operation_unknown', { cause });
	}
}

function sendFailure(error: unknown, request: HttpRequest, reply: HttpReply): void {
	const code = codeFor(error);
	if (reply.sent || reply.raw.headersSent) {
		reply.raw.destroy();
	} else if (!reply.raw.destroyed && !reply.raw.writableEnded) {
		reply
			.removeHeader('Content-Length')
			.type('application/json; charset=utf-8')
			.serializer(JSON.stringify)
			.code(ERROR_STATUS[code])
			.send({ code });
	}
}

function httpErrorHandler(error: unknown, request: HttpRequest, reply: HttpReply): void {
	if (!(error instanceof ThemeFailure)) {
		throw error;
	}
	sendFailure(error, request, reply);
}

async function handle(request: HttpRequest, reply: HttpReply, work: () => Promise<void>): Promise<void> {
	try {
		if (request.query.size) {
			throw new ThemeFailure('invalid_input');
		}
		await work();
	} catch (error) {
		sendFailure(error, request, reply);
	}
}

async function readImport(
	request: HttpRequest,
	reply: HttpReply,
	upstream: AbortSignal,
): Promise<TerminalThemeImportRequest> {
	const controller = new AbortController();
	const active = AbortSignal.any([upstream, controller.signal]);
	const timer = setTimeout(() => controller.abort(), 30000);

	const disconnected = () => {
		if (!reply.raw.writableFinished) {
			controller.abort();
		}
	};

	reply.raw.on('close', disconnected);
	let parts: MultipartPart[] = [];
	try {
		const type = request.raw.headers['content-type'];
		if (typeof type !== 'string') {
			throw new ThemeFailure('unsupported_media_type');
		}
		parts = await readMultipart(
			request,
			reply,
			{
				maxParts: 2,
				maxFileBytes: TERMINAL_THEME_IMPORT_MAX_BYTES,
				maxFieldBytes: TERMINAL_THEME_NAME_MAX_BYTES,
			},
			active,
		);
		const file = parts.find((part) => part.name === 'themeFile');
		const name = parts.find((part) => part.name === 'name');
		if (file && file.bytes.byteLength > TERMINAL_THEME_IMPORT_MAX_BYTES) {
			throw new ThemeFailure('limit_exceeded');
		}
		if (
			!file ||
			file.filename === null ||
			parts.some((part) => part !== file && part !== name) ||
			(name && name.filename !== null)
		) {
			throw new ThemeFailure('invalid_input');
		}
		if (file.contentType !== 'application/json' && !file.filename.toLowerCase().endsWith('.json')) {
			throw new ThemeFailure('unsupported_media_type');
		}
		const decode = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
		let raw: unknown;
		let selectedName: string;
		try {
			raw = JSON.parse(decode.decode(file.bytes));
			selectedName =
				name === undefined
					? file.filename.replace(/\.json$/iu, '')
					: decode.decode(name.bytes).trim() || file.filename.replace(/\.json$/iu, '');
		} catch (cause) {
			throw new ThemeFailure('invalid_input', { cause });
		}
		if (name && name.bytes.byteLength > TERMINAL_THEME_NAME_MAX_BYTES) {
			throw new ThemeFailure('limit_exceeded');
		}
		const themeData = readTerminalThemeColors(raw);
		return readTerminalThemeCreate({ name: selectedName, themeData });
	} catch (cause) {
		if (cause instanceof ThemeFailure) {
			throw cause;
		}
		const code = codeFor(cause);
		throw new ThemeFailure(active.aborted && code === 'internal_failure' ? 'unavailable' : code, { cause });
	} finally {
		for (const part of parts) {
			part.bytes.fill(0);
		}
		clearTimeout(timer);
		reply.raw.off('close', disconnected);
	}
}

export function createThemeRoutes(service: ThemeService, access: AccessPublicApi): HttpRoute[] {
	const path = '/api/v1/terminal-themes';
	return [
		{
			method: 'GET',
			url: path,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					const rows = await service.list(actor);
					await revalidate(request, reply, access, actor);
					send(request, reply, 200, rows.map(toWireTheme));
				}),
		},
		{
			method: 'POST',
			url: path,
			bodyLimit: TERMINAL_THEME_REQUEST_MAX_BYTES,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					const input = readTerminalThemeCreate(request.body);
					await revalidate(request, reply, access, actor);
					ready(request, reply);
					const saved = await service.create(actor, toApplicationTheme(input));
					await deliver(request, reply, access, actor, 201, () => toWireTheme(saved));
				}),
		},
		{
			method: 'POST',
			url: path + '/import',
			bodyLimit: TERMINAL_THEME_MULTIPART_MAX_BYTES,
			config: { multipartBodyLimit: TERMINAL_THEME_MULTIPART_MAX_BYTES },

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					const saved = await service.import(actor, async (signal) => {
						const input = await readImport(request, reply, signal);
						await revalidate(request, reply, access, actor);
						ready(request, reply);
						if (signal.aborted) {
							throw new ThemeFailure('unavailable');
						}
						return toApplicationTheme(input);
					});
					await deliver(request, reply, access, actor, 201, () => toWireTheme(saved));
				}),
		},
		{
			method: 'GET',
			url: path + '/:id/export',

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					const item = await service.get(actor, readTerminalThemeId(request.params.id));
					await revalidate(request, reply, access, actor);
					ready(request, reply);
					const filename =
						item.name
							.replace(/[^a-z0-9]/giu, '_')
							.toLowerCase()
							.slice(0, 128) + '.json';
					reply.headers({
						'Content-Disposition': 'attachment; filename="' + filename + '"',
					});
					send(request, reply, 200, toWireThemeColors(item.colors));
				}),
		},
		{
			method: 'GET',
			url: path + '/:id',

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					const item = await service.get(actor, readTerminalThemeId(request.params.id));
					await revalidate(request, reply, access, actor);
					send(request, reply, 200, toWireTheme(item));
				}),
		},
		{
			method: 'PUT',
			url: path + '/:id',
			bodyLimit: TERMINAL_THEME_REQUEST_MAX_BYTES,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					const id = readTerminalThemeId(request.params.id);
					const input = readTerminalThemeUpdate(request.body);
					await revalidate(request, reply, access, actor);
					ready(request, reply);
					const saved = await service.update(actor, {
						id,
						expectedVersion: input.expectedVersion,
						input: toApplicationTheme({ name: input.name, themeData: input.themeData }),
					});
					await deliver(request, reply, access, actor, 200, () => toWireTheme(saved));
				}),
		},
		{
			method: 'DELETE',
			url: path + '/:id',
			bodyLimit: TERMINAL_THEME_REQUEST_MAX_BYTES,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					const id = readTerminalThemeId(request.params.id);
					const input = readTerminalThemeDelete(request.body);
					await revalidate(request, reply, access, actor);
					ready(request, reply);
					await service.delete(actor, { id, expectedVersion: input.expectedVersion });
					await deliver(request, reply, access, actor, 200, () => ({ deleted: true }));
				}),
		},
	];
}
