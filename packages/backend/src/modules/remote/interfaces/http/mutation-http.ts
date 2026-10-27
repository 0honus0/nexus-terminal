import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import type { HttpRoute } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import { InvalidPayload } from '@nexus-terminal/shared/common/http-codec';
import {
	readMutationId,
	readMutationQuery,
	readMutationEvidence,
	readMutationRelease,
} from '@nexus-terminal/shared/remote/mutations/http-codec';
import { MUTATION_BODY_MAX_BYTES, MUTATION_ID_MAX_BYTES } from '@nexus-terminal/shared/remote/mutations/values';
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
	const routes: HttpRoute[] = [
		{
			method: 'GET',
			path: root,

			async handle(ctx) {
				const query = readMutationQuery(ctx.query);
				const value = await owner.list(ctx.cookie(ACCESS_SESSION_COOKIE_NAME), query.after, query.limit);
				ctx.send(200, {
					items: value.items.map(toMutationView),
					nextCursor: value.nextCursor,
				} satisfies MutationListResponse);
			},
		},
		{
			method: 'GET',
			path: root + '/:id',

			async handle(ctx) {
				if (ctx.query.size) {
					throw new InvalidPayload();
				}
				ctx.send(
					200,
					toMutationView(
						await owner.get(ctx.cookie(ACCESS_SESSION_COOKIE_NAME), readMutationId(ctx.params.id)),
					),
				);
			},
		},
		{
			method: 'POST',
			path: root + '/:id/evidence',

			async handle(ctx) {
				if (ctx.query.size) {
					throw new InvalidPayload();
				}
				const input = toMutationEvidence(readMutationEvidence(await ctx.json()));
				ctx.send(
					200,
					toMutationView(
						await owner.recordEvidence(
							ctx.cookie(ACCESS_SESSION_COOKIE_NAME),
							readMutationId(ctx.params.id),
							input,
						),
					),
				);
			},
		},
		{
			method: 'POST',
			path: root + '/:id/release',

			async handle(ctx) {
				if (ctx.query.size) {
					throw new InvalidPayload();
				}
				const input = toMutationRelease(readMutationRelease(await ctx.json()));
				ctx.send(
					200,
					toMutationView(
						await owner.release(
							ctx.cookie(ACCESS_SESSION_COOKIE_NAME),
							readMutationId(ctx.params.id),
							input,
						),
					),
				);
			},
		},
	];
	return routes.map((route) => ({
		method: route.method,
		path: route.path,
		maxBodyBytes: MUTATION_BODY_MAX_BYTES,
		maxPathParameterBytes: MUTATION_ID_MAX_BYTES,
		pathParameterAlphabet: 'opaque',

		async handle(ctx) {
			try {
				await route.handle(ctx);
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
				ctx.send(status(code), { code } satisfies MutationFailureResponse);
			}
		},
	}));
}
