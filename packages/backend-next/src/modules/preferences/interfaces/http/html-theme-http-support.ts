import type { HttpRouteContext } from '../../../../platform/http/http-types.js';
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
import { authenticate, revalidate, ready } from './appearance-http-support.js';
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
	if (error instanceof AppearanceFailure && ['unauthenticated', 'forbidden', 'unavailable'].includes(error.code)) {
		return error.code === 'unauthenticated'
			? 'unauthenticated'
			: error.code === 'forbidden'
				? 'forbidden'
				: 'unavailable';
	}
	if (
		error instanceof AccessOperationError &&
		(error.code === 'storage_unavailable' || error.code === 'operation_unknown')
	) {
		return error.code;
	}
	return 'internal_failure';
}

export async function handleHtmlTheme(
	context: HttpRouteContext,
	work: () => Promise<void>,
	allowQuery = false,
): Promise<void> {
	try {
		if (!allowQuery && context.query.size) {
			throw new HtmlThemeFailure('invalid_input');
		}
		await work();
	} catch (error) {
		const code = errorCode(error);
		if (context.response.headersSent) {
			context.response.destroy();
		} else if (!context.response.destroyed && !context.response.writableEnded) {
			context.send(STATUS[code], { code });
		}
	}
}

export async function deliverHtmlTheme(
	context: HttpRouteContext,
	access: AccessPublicApi,
	actor: HtmlThemeActor,
	status: number,
	body: unknown,
): Promise<void> {
	try {
		await revalidateHtmlTheme(context, access, actor);
		ready(context);
		if (Buffer.byteLength(JSON.stringify(body)) > HTML_THEME_RESPONSE_MAX_BYTES) {
			throw new HtmlThemeFailure('limit_exceeded');
		}
		context.send(status, body);
	} catch (cause) {
		throw new HtmlThemeFailure('operation_unknown', { cause });
	}
}

export async function readHtmlThemeInput<T>(
	context: HttpRouteContext,
	access: AccessPublicApi,
	actor: HtmlThemeActor,
	ownerSignal: AbortSignal,
	decode: (input: unknown) => T,
): Promise<T> {
	return withAppearanceDeadline(context, async (deadlineSignal) => {
		const signal = AbortSignal.any([ownerSignal, deadlineSignal]);
		const input = decode(await context.json(signal));
		await revalidateHtmlTheme(context, access, actor);
		ready(context);
		signal.throwIfAborted();
		return input;
	});
}

export function sendHtmlThemeText(context: HttpRouteContext, content: string, signal: AbortSignal): Promise<void> {
	ready(context);
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			context.response.off('finish', finished);
			context.response.off('close', closed);
			context.response.off('error', failed);
			signal.removeEventListener('abort', aborted);
		};

		const finished = () => {
			cleanup();
			resolve();
		};

		const failed = (cause: unknown) => {
			cleanup();
			reject(new HtmlThemeFailure('unavailable', { cause }));
		};

		const closed = () => {
			if (context.response.writableFinished) {
				finished();
			} else {
				failed(new HtmlThemeFailure('unavailable'));
			}
		};

		const aborted = () => {
			context.response.destroy();
			failed(new HtmlThemeFailure('unavailable'));
		};

		if (signal.aborted || context.response.destroyed) {
			failed(new HtmlThemeFailure('unavailable'));
			return;
		}
		context.response.once('finish', finished);
		context.response.once('close', closed);
		context.response.once('error', failed);
		signal.addEventListener('abort', aborted, { once: true });
		try {
			context.response.setHeader('Content-Type', 'text/plain; charset=utf-8');
			context.response.setHeader('Content-Length', String(Buffer.byteLength(content)));
			context.response.setHeader(
				'Content-Security-Policy',
				"sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",
			);
			context.response.setHeader('X-Content-Type-Options', 'nosniff');
			context.response.setHeader('Cache-Control', 'private, no-store');
			context.response.end(content);
		} catch (cause) {
			failed(cause);
		}
	});
}

export async function revalidateHtmlTheme(
	context: HttpRouteContext,
	access: AccessPublicApi,
	actor: HtmlThemeActor,
): Promise<void> {
	try {
		await revalidate(context, access, actor);
	} catch (cause) {
		throw new HtmlThemeFailure(errorCode(cause), { cause });
	}
}
