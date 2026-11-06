import type { HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import { finished } from 'node:stream/promises';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import { InvalidPayload } from '@nexus-terminal/shared/common/http-codec';
import {
	HTML_THEME_RESPONSE_MAX_BYTES,
	type HtmlThemeErrorCode,
} from '@nexus-terminal/shared/preferences/html-themes/values';
import type { AccessPublicApi } from '../../../access/public.js';
import type { HtmlThemeActor } from '../../appearance/model/html-theme-types.js';
import { HtmlThemeFailure } from '../../html-theme-failure.js';
import { AppearanceFailure } from '../../appearance-failure.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import { revalidate, ready } from './appearance-http-support.js';
import { withAppearanceDeadline } from './appearance-http-deadline.js';
const STATUS: Record<HtmlThemeErrorCode, number> = {
	invalid_input: 400,
	unauthenticated: 401,
	forbidden: 403,
	not_found: 404,
	name_conflict: 409,
	version_conflict: 409,
	limit_exceeded: 413,
	storage_unavailable: 503,
	operation_unknown: 503,
	internal_failure: 503,
	unavailable: 503,
	unsupported_media_type: 415,
	source_invalid: 400,
	source_unavailable: 503,
	source_changed: 409,
	cleanup_failed: 503,
};

function errorCode(error: unknown): HtmlThemeErrorCode {
	if (error instanceof HtmlThemeFailure) {
		return error.code;
	}
	if (error instanceof InvalidPayload || error instanceof SyntaxError) {
		return 'invalid_input';
	}
	if (error instanceof HttpInputFailure) {
		return error.status === 413
			? 'limit_exceeded'
			: error.status === 415
				? 'unsupported_media_type'
				: 'invalid_input';
	}
	if (error instanceof AppearanceFailure) {
		return error.code === 'theme_not_found' ? 'not_found' : error.code;
	}
	if (
		error instanceof AccessOperationError &&
		(error.code === 'storage_unavailable' || error.code === 'operation_unknown')
	) {
		return error.code;
	}
	return 'internal_failure';
}

function sendFailure(error: unknown, request: HttpRequest, reply: HttpReply): void {
	const code = errorCode(error);
	if (reply.sent || reply.raw.headersSent) {
		reply.raw.destroy();
	} else if (!reply.raw.destroyed && !reply.raw.writableEnded) {
		reply
			.removeHeader('Content-Length')
			.type('application/json; charset=utf-8')
			.serializer(JSON.stringify)
			.code(STATUS[code])
			.send({ code });
	}
}

export function htmlThemeHttpErrorHandler(error: unknown, request: HttpRequest, reply: HttpReply): void {
	if (!(error instanceof HtmlThemeFailure)) {
		throw error;
	}
	sendFailure(error, request, reply);
}

export async function handleHtmlTheme(
	request: HttpRequest,
	reply: HttpReply,
	work: () => Promise<void>,
	allowQuery = false,
): Promise<void> {
	try {
		if (!allowQuery && request.query.size) {
			throw new HtmlThemeFailure('invalid_input');
		}
		await work();
	} catch (error) {
		sendFailure(error, request, reply);
	}
}

export function sendHtmlThemeJson(reply: HttpReply, status: number, body: unknown, mutation = false): void {
	reply.type('application/json; charset=utf-8').serializer((payload) => {
		try {
			const encoded = JSON.stringify(payload);
			if (encoded === undefined) {
				throw new HtmlThemeFailure('internal_failure');
			}
			if (Buffer.byteLength(encoded, 'utf8') > HTML_THEME_RESPONSE_MAX_BYTES) {
				throw new HtmlThemeFailure('limit_exceeded');
			}
			return encoded;
		} catch (cause) {
			throw new HtmlThemeFailure(
				mutation ? 'operation_unknown' : cause instanceof HtmlThemeFailure ? cause.code : 'internal_failure',
				{ cause },
			);
		}
	});
	reply.code(status).send(body);
}

export async function deliverHtmlTheme(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
	actor: HtmlThemeActor,
	status: number,
	body: unknown,
): Promise<void> {
	try {
		await revalidateHtmlTheme(request, reply, access, actor);
		ready(request, reply);
		sendHtmlThemeJson(reply, status, body, true);
	} catch (cause) {
		throw new HtmlThemeFailure('operation_unknown', { cause });
	}
}

export async function readHtmlThemeInput<T>(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
	actor: HtmlThemeActor,
	ownerSignal: AbortSignal,
	decode: (input: unknown) => T,
): Promise<T> {
	try {
		return await withAppearanceDeadline(request, reply, async (deadlineSignal) => {
			const signal = AbortSignal.any([ownerSignal, deadlineSignal]);
			const input = decode(request.body);
			await revalidateHtmlTheme(request, reply, access, actor);
			ready(request, reply);
			signal.throwIfAborted();
			return input;
		});
	} catch (cause) {
		if (cause instanceof HtmlThemeFailure) {
			throw cause;
		}
		const code = errorCode(cause);
		const cancelled =
			ownerSignal.aborted && code === 'internal_failure' && !(cause instanceof AccessOperationError);
		throw new HtmlThemeFailure(cancelled ? 'unavailable' : code, {
			cause,
		});
	}
}

export async function sendHtmlThemeText(
	request: HttpRequest,
	reply: HttpReply,
	content: string,
	signal: AbortSignal,
): Promise<void> {
	try {
		if (signal.aborted || reply.raw.destroyed || reply.raw.writableEnded) {
			throw new HtmlThemeFailure('unavailable');
		}
		reply.helmet({
			contentSecurityPolicy: {
				useDefaults: false,
				directives: {
					sandbox: [],
					defaultSrc: ["'none'"],
					baseUri: ["'none'"],
					formAction: ["'none'"],
				},
			},
		});
		reply
			.code(200)
			.headers({
				'Content-Type': 'text/plain; charset=utf-8',
				'Cache-Control': 'private, no-store',
			})
			.send(Buffer.from(content));
		await finished(reply.raw, { signal, cleanup: true });
		if (reply.statusCode !== 200 || request.raw.aborted) {
			throw new HtmlThemeFailure('unavailable');
		}
	} catch (cause) {
		if (!reply.raw.writableFinished) {
			reply.raw.destroy();
		}
		throw new HtmlThemeFailure('unavailable', { cause });
	}
}

export async function revalidateHtmlTheme(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
	actor: HtmlThemeActor,
): Promise<void> {
	try {
		await revalidate(request, reply, access, actor);
	} catch (cause) {
		throw new HtmlThemeFailure(errorCode(cause), { cause });
	}
}
