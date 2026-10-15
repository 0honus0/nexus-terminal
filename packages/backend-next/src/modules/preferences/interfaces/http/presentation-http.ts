import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
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

async function authenticate(context: HttpRouteContext, access: AccessPublicApi): Promise<PresentationActor> {
	const token = context.cookie(ACCESS_SESSION_COOKIE_NAME);
	const identity = await access.authenticate(token);
	if (!token || !identity) {
		throw new PresentationFailure('unauthenticated');
	}
	return { userId: identity.userId, token };
}

async function revalidate(context: HttpRouteContext, access: AccessPublicApi, actor: PresentationActor): Promise<void> {
	const current = await authenticate(context, access);
	if (current.userId !== actor.userId || current.token !== actor.token) {
		throw new PresentationFailure('forbidden');
	}
}

function ready(context: HttpRouteContext): void {
	if (context.response.destroyed || context.response.writableEnded) {
		throw new PresentationFailure('unavailable');
	}
}

function send(context: HttpRouteContext, body: unknown): void {
	if (Buffer.byteLength(JSON.stringify(body), 'utf8') > PRESENTATION_RESPONSE_MAX_BYTES) {
		throw new PresentationFailure('limit_exceeded');
	}
	ready(context);
	context.send(200, body);
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

async function handle(context: HttpRouteContext, work: () => Promise<void>): Promise<void> {
	try {
		if (context.query.size) {
			throw new InvalidPresentationPayload();
		}
		await work();
	} catch (error) {
		const code = failureCode(error);
		if (!context.response.destroyed && !context.response.writableEnded) {
			context.send(error instanceof HttpInputFailure ? error.status : ERROR_STATUS[code], { code });
		}
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
		path,

		handle: (context) =>
			handle(context, async () => {
				const actor = await authenticate(context, access);
				const value = await service.get(actor);
				await revalidate(context, access, actor);
				send(context, project(value));
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
		path,
		maxBodyBytes: PRESENTATION_REQUEST_MAX_BYTES,

		handle: (context) =>
			handle(context, async () => {
				const actor = await authenticate(context, access);
				const command = decode(await context.json());
				await revalidate(context, access, actor);
				ready(context);
				const saved = await service.update(actor, command);
				try {
					await revalidate(context, access, actor);
					const body: PresentationUpdateResponse = { version: saved.version, value: toWireData(saved.value) };
					send(context, body);
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
