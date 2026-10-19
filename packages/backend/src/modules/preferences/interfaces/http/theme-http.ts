import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import { readBodyBytes, decodeMultipart } from '../../../../platform/http/http-body.js';
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

async function authenticate(context: HttpRouteContext, access: AccessPublicApi): Promise<ThemeActor> {
	try {
		const token = context.cookie(ACCESS_SESSION_COOKIE_NAME);
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

async function revalidate(context: HttpRouteContext, access: AccessPublicApi, actor: ThemeActor): Promise<void> {
	const current = await authenticate(context, access);
	if (current.userId !== actor.userId || current.token !== actor.token) {
		throw new ThemeFailure('forbidden');
	}
}

function ready(context: HttpRouteContext): void {
	if (context.response.destroyed || context.response.writableEnded) {
		throw new ThemeFailure('unavailable');
	}
}

function send(context: HttpRouteContext, status: number, body: unknown): void {
	if (Buffer.byteLength(JSON.stringify(body)) > TERMINAL_THEME_RESPONSE_MAX_BYTES) {
		throw new ThemeFailure('limit_exceeded');
	}
	ready(context);
	context.send(status, body);
}

async function deliver(
	context: HttpRouteContext,
	access: AccessPublicApi,
	actor: ThemeActor,
	status: number,
	project: () => unknown,
): Promise<void> {
	try {
		await revalidate(context, access, actor);
		send(context, status, project());
	} catch (cause) {
		throw new ThemeFailure('operation_unknown', { cause });
	}
}

async function handle(context: HttpRouteContext, work: () => Promise<void>): Promise<void> {
	try {
		if (context.query.size) {
			throw new ThemeFailure('invalid_input');
		}
		await work();
	} catch (error) {
		const code = codeFor(error);
		if (context.response.headersSent) {
			context.response.destroy();
		} else if (!context.response.destroyed && !context.response.writableEnded) {
			context.send(ERROR_STATUS[code], { code });
		}
	}
}

async function readImport(context: HttpRouteContext, upstream: AbortSignal): Promise<TerminalThemeImportRequest> {
	const controller = new AbortController();
	const active = AbortSignal.any([upstream, controller.signal]);
	const timer = setTimeout(() => controller.abort(), 30000);

	const disconnected = () => {
		if (!context.response.writableFinished) {
			controller.abort();
		}
	};

	context.response.on('close', disconnected);
	try {
		const type = context.request.headers['content-type'];
		if (typeof type !== 'string') {
			throw new ThemeFailure('unsupported_media_type');
		}
		const bytes = await readBodyBytes(context.request, TERMINAL_THEME_MULTIPART_MAX_BYTES, active);
		const parts = decodeMultipart(bytes, type, 2);
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
		clearTimeout(timer);
		context.response.off('close', disconnected);
	}
}

export function createThemeRoutes(service: ThemeService, access: AccessPublicApi): HttpRoute[] {
	const path = '/api/v1/terminal-themes';
	return [
		{
			method: 'GET',
			path,

			handle: (context) =>
				handle(context, async () => {
					const actor = await authenticate(context, access);
					const rows = await service.list(actor);
					await revalidate(context, access, actor);
					send(context, 200, rows.map(toWireTheme));
				}),
		},
		{
			method: 'POST',
			path,
			maxBodyBytes: TERMINAL_THEME_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, async () => {
					const actor = await authenticate(context, access);
					const input = readTerminalThemeCreate(await context.json());
					await revalidate(context, access, actor);
					ready(context);
					const saved = await service.create(actor, toApplicationTheme(input));
					await deliver(context, access, actor, 201, () => toWireTheme(saved));
				}),
		},
		{
			method: 'POST',
			path: path + '/import',
			maxBodyBytes: TERMINAL_THEME_MULTIPART_MAX_BYTES,

			handle: (context) =>
				handle(context, async () => {
					const actor = await authenticate(context, access);
					const saved = await service.import(actor, async (signal) => {
						const input = await readImport(context, signal);
						await revalidate(context, access, actor);
						ready(context);
						if (signal.aborted) {
							throw new ThemeFailure('unavailable');
						}
						return toApplicationTheme(input);
					});
					await deliver(context, access, actor, 201, () => toWireTheme(saved));
				}),
		},
		{
			method: 'GET',
			path: path + '/:id/export',

			handle: (context) =>
				handle(context, async () => {
					const actor = await authenticate(context, access);
					const item = await service.get(actor, readTerminalThemeId(context.params.id));
					await revalidate(context, access, actor);
					ready(context);
					const filename =
						item.name
							.replace(/[^a-z0-9]/giu, '_')
							.toLowerCase()
							.slice(0, 128) + '.json';
					context.send(200, toWireThemeColors(item.colors), {
						'Content-Disposition': 'attachment; filename="' + filename + '"',
					});
				}),
		},
		{
			method: 'GET',
			path: path + '/:id',

			handle: (context) =>
				handle(context, async () => {
					const actor = await authenticate(context, access);
					const item = await service.get(actor, readTerminalThemeId(context.params.id));
					await revalidate(context, access, actor);
					send(context, 200, toWireTheme(item));
				}),
		},
		{
			method: 'PUT',
			path: path + '/:id',
			maxBodyBytes: TERMINAL_THEME_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, async () => {
					const actor = await authenticate(context, access);
					const id = readTerminalThemeId(context.params.id);
					const input = readTerminalThemeUpdate(await context.json());
					await revalidate(context, access, actor);
					ready(context);
					const saved = await service.update(actor, {
						id,
						expectedVersion: input.expectedVersion,
						input: toApplicationTheme({ name: input.name, themeData: input.themeData }),
					});
					await deliver(context, access, actor, 200, () => toWireTheme(saved));
				}),
		},
		{
			method: 'DELETE',
			path: path + '/:id',
			maxBodyBytes: TERMINAL_THEME_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, async () => {
					const actor = await authenticate(context, access);
					const id = readTerminalThemeId(context.params.id);
					const input = readTerminalThemeDelete(await context.json());
					await revalidate(context, access, actor);
					ready(context);
					await service.delete(actor, { id, expectedVersion: input.expectedVersion });
					await deliver(context, access, actor, 200, () => ({ deleted: true }));
				}),
		},
	];
}
