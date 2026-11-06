import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import { InvalidPayload } from '@nexus-terminal/shared/common/http-codec';
import {
	readMutationId,
	readMutationQuery,
	readMutationEvidence,
	readMutationRelease,
} from '@nexus-terminal/shared/remote/mutations/http-codec';
import { MUTATION_BODY_MAX_BYTES } from '@nexus-terminal/shared/remote/mutations/values';
import type { MutationErrorCode } from '@nexus-terminal/shared/remote/mutations/values';
import type { MutationFailureResponse, MutationListResponse } from '@nexus-terminal/shared/remote/mutations/http';
import type { MutationRecoveryService } from '../../machines/service/mutation-recovery-service.js';
import { MutationRecoveryFailure } from '../../mutation-failure.js';
import { toMutationView, toMutationEvidence, toMutationRelease } from './mutation-mapper.js';

function status(code: MutationErrorCode): number {
	switch (code) {
		case 'invalid_input':
			return 400;
		case 'unauthenticated':
			return 401;
		case 'forbidden':
			return 403;
		case 'not_found':
			return 404;
		case 'version_conflict':
		case 'resource_active':
			return 409;
		case 'limit_exceeded':
			return 413;
		case 'storage_unavailable':
		case 'shutting_down':
			return 503;
		case 'operation_unknown':
			return 500;
	}
}

export function createMutationHttpRoutes(owner: MutationRecoveryService): HttpRoute[] {
	const root = '/api/v1/remote/mutations';
	const routes = [
		{
			method: 'GET',
			url: root,

			async handler(request: HttpRequest, reply: HttpReply) {
				const query = readMutationQuery(request.query);
				const value = await owner.list(
					readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
					query.after,
					query.limit,
				);
				reply.code(200).send({
					items: value.items.map(toMutationView),
					nextCursor: value.nextCursor,
				} satisfies MutationListResponse);
			},
		},
		{
			method: 'GET',
			url: root + '/:id',

			async handler(request: HttpRequest, reply: HttpReply) {
				if (request.query.size) {
					throw new InvalidPayload();
				}
				reply
					.code(200)
					.send(
						toMutationView(
							await owner.get(
								readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
								readMutationId(request.params.id),
							),
						),
					);
			},
		},
		{
			method: 'POST',
			url: root + '/:id/evidence',

			async handler(request: HttpRequest, reply: HttpReply) {
				if (request.query.size) {
					throw new InvalidPayload();
				}
				const input = toMutationEvidence(readMutationEvidence(request.body));
				reply
					.code(200)
					.send(
						toMutationView(
							await owner.recordEvidence(
								readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
								readMutationId(request.params.id),
								input,
							),
						),
					);
			},
		},
		{
			method: 'POST',
			url: root + '/:id/release',

			async handler(request: HttpRequest, reply: HttpReply) {
				if (request.query.size) {
					throw new InvalidPayload();
				}
				const input = toMutationRelease(readMutationRelease(request.body));
				reply
					.code(200)
					.send(
						toMutationView(
							await owner.release(
								readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
								readMutationId(request.params.id),
								input,
							),
						),
					);
			},
		},
	] satisfies HttpRoute[];
	return routes.map((route) => ({
		method: route.method,
		url: route.url,
		bodyLimit: MUTATION_BODY_MAX_BYTES,

		async handler(request: HttpRequest, reply: HttpReply) {
			try {
				await route.handler(request, reply);
			} catch (error) {
				if (error instanceof HttpInputFailure) {
					throw error;
				}
				const code =
					error instanceof MutationRecoveryFailure
						? error.code
						: error instanceof InvalidPayload
							? 'invalid_input'
							: 'storage_unavailable';
				reply.code(status(code)).send({ code } satisfies MutationFailureResponse);
			}
		},
	}));
}
