import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
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

export async function authenticate(context: HttpRouteContext, access: AccessPublicApi): Promise<AppearanceActor> {
	const token = context.cookie(ACCESS_SESSION_COOKIE_NAME);
	const identity = await access.authenticate(token);
	if (!identity || !token) {
		throw new AppearanceFailure('unauthenticated');
	}
	return { userId: identity.userId, token };
}

export async function revalidate(
	context: HttpRouteContext,
	access: AccessPublicApi,
	actor: AppearanceActor,
): Promise<void> {
	const current = await authenticate(context, access);
	if (current.userId !== actor.userId || current.token !== actor.token) {
		throw new AppearanceFailure('forbidden');
	}
}

export function ready(context: HttpRouteContext): void {
	if (context.response.destroyed || context.response.writableEnded) {
		throw new AppearanceFailure('unavailable');
	}
}

export async function deliver(
	context: HttpRouteContext,
	access: AccessPublicApi,
	actor: AppearanceActor,
	project: () => unknown,
): Promise<void> {
	try {
		await revalidate(context, access, actor);
		const body = project();
		if (Buffer.byteLength(JSON.stringify(body)) > APPEARANCE_RESPONSE_MAX_BYTES) {
			throw new AppearanceFailure('limit_exceeded');
		}
		ready(context);
		context.send(200, body);
	} catch (cause) {
		throw new AppearanceFailure('operation_unknown', { cause });
	}
}

export async function handle(context: HttpRouteContext, work: () => Promise<void>): Promise<void> {
	try {
		if (context.query.size) {
			throw new AppearanceFailure('invalid_input');
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
