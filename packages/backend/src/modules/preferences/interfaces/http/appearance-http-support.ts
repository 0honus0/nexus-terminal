import { readRequestCookie } from '../../../../platform/http/http-request.js';
import type { HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import { InvalidPayload } from '@nexus-terminal/shared/common/http-codec';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import {
	APPEARANCE_RESPONSE_MAX_BYTES,
	type AppearanceErrorCode,
} from '@nexus-terminal/shared/preferences/appearance/values';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import { AppearanceFailure } from '../../appearance-failure.js';
import type { AppearanceActor } from '../../appearance/model/appearance-types.js';
const ERROR_STATUS: Record<AppearanceErrorCode, number> = {
	invalid_input: 400,
	unauthenticated: 401,
	forbidden: 403,
	version_conflict: 409,
	theme_not_found: 404,
	not_found: 404,
	cleanup_failed: 503,
	limit_exceeded: 413,
	storage_unavailable: 503,
	operation_unknown: 503,
	internal_failure: 503,
	unavailable: 503,
	unsupported_media_type: 415,
};

function codeFor(error: unknown): AppearanceErrorCode {
	if (error instanceof AppearanceFailure) {
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

export async function readAppearanceInput<T>(signal: AbortSignal, load: () => Promise<T>): Promise<T> {
	try {
		return await load();
	} catch (cause) {
		if (cause instanceof AppearanceFailure) {
			throw cause;
		}
		const code = codeFor(cause);
		const cancelled = signal.aborted && code === 'internal_failure' && !(cause instanceof AccessOperationError);
		throw new AppearanceFailure(cancelled ? 'unavailable' : code, { cause });
	}
}

export async function authenticate(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
): Promise<AppearanceActor> {
	try {
		const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME);
		const identity = await access.authenticate(token);
		if (!identity || !token) {
			throw new AppearanceFailure('unauthenticated');
		}
		return { userId: identity.userId, token };
	} catch (cause) {
		if (cause instanceof AppearanceFailure) {
			throw cause;
		}
		throw new AppearanceFailure(codeFor(cause), { cause });
	}
}

export async function revalidate(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
	actor: AppearanceActor,
): Promise<void> {
	const current = await authenticate(request, reply, access);
	if (current.userId !== actor.userId || current.token !== actor.token) {
		throw new AppearanceFailure('forbidden');
	}
}

export function ready(request: HttpRequest, reply: HttpReply): void {
	if (reply.raw.destroyed || reply.raw.writableEnded) {
		throw new AppearanceFailure('unavailable');
	}
}

export function sendAppearanceJson(reply: HttpReply, body: unknown, mutation = false): void {
	reply.type('application/json; charset=utf-8').serializer((payload) => {
		try {
			const encoded = JSON.stringify(payload);
			if (encoded === undefined) {
				throw new AppearanceFailure('internal_failure');
			}
			if (Buffer.byteLength(encoded, 'utf8') > APPEARANCE_RESPONSE_MAX_BYTES) {
				throw new AppearanceFailure('limit_exceeded');
			}
			return encoded;
		} catch (cause) {
			throw new AppearanceFailure(
				mutation ? 'operation_unknown' : cause instanceof AppearanceFailure ? cause.code : 'internal_failure',
				{ cause },
			);
		}
	});
	reply.code(200).send(body);
}

export async function deliver(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
	actor: AppearanceActor,
	project: () => unknown,
): Promise<void> {
	try {
		await revalidate(request, reply, access, actor);
		const body = project();
		ready(request, reply);
		sendAppearanceJson(reply, body, true);
	} catch (cause) {
		throw new AppearanceFailure('operation_unknown', { cause });
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

export function appearanceHttpErrorHandler(error: unknown, request: HttpRequest, reply: HttpReply): void {
	if (!(error instanceof AppearanceFailure)) {
		throw error;
	}
	sendFailure(error, request, reply);
}

export async function handle(request: HttpRequest, reply: HttpReply, work: () => Promise<void>): Promise<void> {
	try {
		if (request.query.size) {
			throw new AppearanceFailure('invalid_input');
		}
		await work();
	} catch (error) {
		sendFailure(error, request, reply);
	}
}
