import { readRequestCookie } from '../../../../platform/http/http-request.js';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import {
	PRESENTATION_REQUEST_MAX_BYTES,
	PRESENTATION_RESPONSE_MAX_BYTES,
	type PresentationErrorCode,
} from '@nexus-terminal/shared/preferences/presentation/values';
import {
	readPreferencesUpdate,
	readLayoutUpdate,
	readFocusUpdate,
	readSidebarUpdate,
	readWorkspaceLayoutUpdate,
	InvalidPresentationPayload,
} from '@nexus-terminal/shared/preferences/presentation/http-codec';
import type {
	PreferencesResponse,
	LayoutResponse,
	FocusResponse,
	SidebarResponse,
	PresentationUpdateResponse,
} from '@nexus-terminal/shared/preferences/presentation/http';
import type { PresentationService } from '../../presentation/service/presentation-service.js';
import type {
	PresentationActor,
	PresentationView,
	PresentationChange,
} from '../../presentation/model/presentation-types.js';
import { PresentationFailure } from '../../presentation-failure.js';
import {
	toApplicationPreferences,
	toApplicationLayout,
	toApplicationFocus,
	toApplicationSidebar,
	toWirePreferences,
	toWireLayout,
	toWireFocus,
	toWireSidebar,
	toWireData,
} from './presentation-mapper.js';

const ERROR_STATUS: Record<PresentationErrorCode, number> = {
	invalid_input: 400,
	unauthenticated: 401,
	forbidden: 403,
	version_conflict: 409,
	limit_exceeded: 413,
	storage_unavailable: 503,
	operation_unknown: 503,
	internal_failure: 503,
	unavailable: 503,
};

async function authenticate(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
): Promise<PresentationActor> {
	const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME);
	const identity = await access.authenticate(token);
	if (!token || !identity) {
		throw new PresentationFailure('unauthenticated');
	}
	return { userId: identity.userId, token };
}

async function revalidate(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
	actor: PresentationActor,
): Promise<void> {
	const current = await authenticate(request, reply, access);
	if (current.userId !== actor.userId || current.token !== actor.token) {
		throw new PresentationFailure('forbidden');
	}
}

function ready(request: HttpRequest, reply: HttpReply): void {
	if (reply.raw.destroyed || reply.raw.writableEnded) {
		throw new PresentationFailure('unavailable');
	}
}

function send(request: HttpRequest, reply: HttpReply, body: unknown, mutation = false): void {
	ready(request, reply);
	reply.type('application/json; charset=utf-8').serializer((payload) => {
		try {
			const encoded = JSON.stringify(payload);
			if (encoded === undefined) {
				throw new PresentationFailure('internal_failure');
			}
			if (Buffer.byteLength(encoded, 'utf8') > PRESENTATION_RESPONSE_MAX_BYTES) {
				throw new PresentationFailure('limit_exceeded');
			}
			return encoded;
		} catch (cause) {
			throw new PresentationFailure(
				mutation ? 'operation_unknown' : cause instanceof PresentationFailure ? cause.code : 'internal_failure',
				{ cause },
			);
		}
	});
	reply.code(200).send(body);
}

function failureCode(error: unknown): PresentationErrorCode {
	if (error instanceof PresentationFailure) {
		return error.code;
	}
	if (error instanceof HttpInputFailure) {
		return error.status === 413 ? 'limit_exceeded' : 'invalid_input';
	}
	if (error instanceof InvalidPresentationPayload) {
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

function sendFailure(error: unknown, request: HttpRequest, reply: HttpReply): void {
	const code = failureCode(error);
	if (reply.sent || reply.raw.headersSent) {
		reply.raw.destroy();
	} else if (!reply.raw.destroyed && !reply.raw.writableEnded) {
		reply
			.removeHeader('Content-Length')
			.type('application/json; charset=utf-8')
			.serializer(JSON.stringify)
			.code(error instanceof HttpInputFailure ? error.status : ERROR_STATUS[code])
			.send({ code });
	}
}

function httpErrorHandler(error: unknown, request: HttpRequest, reply: HttpReply): void {
	if (!(error instanceof PresentationFailure)) {
		throw error;
	}
	sendFailure(error, request, reply);
}

async function handle(request: HttpRequest, reply: HttpReply, work: () => Promise<void>): Promise<void> {
	try {
		if (request.query.size) {
			throw new InvalidPresentationPayload();
		}
		await work();
	} catch (error) {
		sendFailure(error, request, reply);
	}
}

function getRoute(
	path: string,
	service: PresentationService,
	access: AccessPublicApi,
	project: (value: PresentationView) => PreferencesResponse | LayoutResponse | FocusResponse | SidebarResponse,
): HttpRoute {
	return {
		method: 'GET',
		url: path,

		errorHandler: httpErrorHandler,

		handler: (request, reply) =>
			handle(request, reply, async () => {
				const actor = await authenticate(request, reply, access);
				const value = await service.get(actor);
				await revalidate(request, reply, access, actor);
				send(request, reply, project(value));
			}),
	};
}

function updateRoute(
	path: string,
	service: PresentationService,
	access: AccessPublicApi,
	decode: (value: unknown) => PresentationChange,
): HttpRoute {
	return {
		method: 'PUT',
		url: path,
		bodyLimit: PRESENTATION_REQUEST_MAX_BYTES,

		errorHandler: httpErrorHandler,

		handler: (request, reply) =>
			handle(request, reply, async () => {
				const actor = await authenticate(request, reply, access);
				const command = decode(request.body);
				await revalidate(request, reply, access, actor);
				ready(request, reply);
				const saved = await service.update(actor, command);
				try {
					await revalidate(request, reply, access, actor);
					const body: PresentationUpdateResponse = { version: saved.version, value: toWireData(saved.value) };
					send(request, reply, body, true);
				} catch (cause) {
					throw new PresentationFailure('operation_unknown', { cause });
				}
			}),
	};
}

export function createPresentationRoutes(service: PresentationService, access: AccessPublicApi): HttpRoute[] {
	const path = '/api/v1/settings';
	return [
		getRoute(path + '/preferences', service, access, (value) => ({
			version: value.version,
			preferences: toWirePreferences(value.value.preferences),
		})),
		getRoute(path + '/layout', service, access, (value) => ({
			version: value.version,
			layout: toWireLayout(value.value.layout),
		})),
		getRoute(path + '/focus-switcher-sequence', service, access, (value) => ({
			version: value.version,
			focus: toWireFocus(value.value.focus),
		})),
		getRoute(path + '/sidebar', service, access, (value) => ({
			version: value.version,
			sidebar: toWireSidebar(value.value.sidebar),
		})),
		updateRoute(path + '/preferences', service, access, (value) => {
			const input = readPreferencesUpdate(value);
			return {
				action: 'preferences',
				expectedVersion: input.expectedVersion,
				preferences: toApplicationPreferences(input.preferences),
			};
		}),
		updateRoute(path + '/layout', service, access, (value) => {
			const input = readLayoutUpdate(value);
			return {
				action: 'layout',
				expectedVersion: input.expectedVersion,
				layout: toApplicationLayout(input.layout),
			};
		}),
		updateRoute(path + '/focus-switcher-sequence', service, access, (value) => {
			const input = readFocusUpdate(value);
			return { action: 'focus', expectedVersion: input.expectedVersion, focus: toApplicationFocus(input.focus) };
		}),
		updateRoute(path + '/sidebar', service, access, (value) => {
			const input = readSidebarUpdate(value);
			return {
				action: 'sidebar',
				expectedVersion: input.expectedVersion,
				sidebar: toApplicationSidebar(input.sidebar),
			};
		}),
		updateRoute(path + '/workspace-layout', service, access, (value) => {
			const input = readWorkspaceLayoutUpdate(value);
			return {
				action: 'workspace',
				expectedVersion: input.expectedVersion,
				layout: toApplicationLayout(input.layout),
				sidebar: toApplicationSidebar(input.sidebar),
			};
		}),
	];
}
